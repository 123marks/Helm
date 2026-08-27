import type {
  OutlookImportResult,
  OutlookKeepaliveResult,
  OutlookPoolItem,
  OutlookPoolStats
} from '@shared/types'
import {
  allocateFromPool,
  exportCombos,
  importCombos,
  listPool,
  poolItemsDueForCheck,
  poolItemsForCheck,
  poolStats,
  purgeDeadPool,
  removePoolItems,
  revealPoolItem,
  rotatePoolRefreshToken,
  setPoolMeta,
  markPoolLinked,
  updatePoolStatus,
  type OutlookPoolSecret
} from '../db/repositories/outlookPool'
import { createAccount } from '../db/repositories/accounts'
import { getSettings } from './settings'
import { logger } from './logger'

const TOKEN_ENDPOINTS = [
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  'https://login.microsoftonline.com/common/oauth2/v2.0/token'
]
const KEEPALIVE_SCOPE =
  'offline_access openid profile https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read'

interface RefreshOutcome {
  ok: boolean
  /** true only when Microsoft says the token is permanently invalid. */
  dead: boolean
  refreshToken?: string
  message: string
}

/** Exchange a refresh token, capturing rotation and distinguishing dead vs transient. */
async function refreshOutlookToken(clientId: string, refreshToken: string): Promise<RefreshOutcome> {
  if (!clientId) return { ok: false, dead: false, message: '缺少 client_id，无法刷新' }
  let last = '刷新失败'
  for (const url of TOKEN_ENDPOINTS) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: KEEPALIVE_SCOPE
        }),
        signal: AbortSignal.timeout(20000)
      })
    } catch (e) {
      last = (e as Error).name === 'AbortError' ? '刷新超时' : (e as Error).message
      continue
    }
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string
      refresh_token?: string
      error?: string
      error_description?: string
    }
    if (json.access_token) {
      return { ok: true, dead: false, refreshToken: json.refresh_token || undefined, message: '令牌有效' }
    }
    const err = json.error || ''
    // invalid_grant = the refresh token is revoked/expired → permanently dead.
    if (err === 'invalid_grant') {
      return { ok: false, dead: true, message: json.error_description || 'refresh token 已失效' }
    }
    last = json.error_description || err || `HTTP ${res.status}`
  }
  return { ok: false, dead: false, message: last }
}

export function importOutlookPool(text: string): OutlookImportResult {
  return importCombos(text)
}

export function listOutlookPool(): OutlookPoolItem[] {
  return listPool()
}

export function outlookPoolStats(): OutlookPoolStats {
  return poolStats()
}

export function removeOutlookPool(ids: string[]): { removed: number } {
  return { removed: removePoolItems(ids) }
}

export function purgeDeadOutlookPool(): { removed: number } {
  return { removed: purgeDeadPool() }
}

export function updateOutlookPoolMeta(ids: string[], patch: { tags?: string[]; notes?: string }): void {
  setPoolMeta(ids, patch)
}

export function exportOutlookPool(ids: string[] | undefined, sixSegment: boolean): string {
  return exportCombos(ids, sixSegment)
}

/** Allocate a ready account for registration/mailbox use. */
export function allocateOutlookAccount(): OutlookPoolSecret | null {
  return allocateFromPool()
}

/**
 * Pull ready Outlook accounts out of the pool and materialize them as first-class
 * Microsoft accounts in the library — instant, no browser, no captcha. Each row
 * is marked in-use and linked so it is not handed out twice.
 */
export function claimOutlookAccounts(count: number): { created: number; emails: string[] } {
  const n = Math.max(1, Math.min(200, Math.floor(count || 1)))
  const emails: string[] = []
  for (let i = 0; i < n; i++) {
    const item = allocateFromPool()
    if (!item) break
    const account = createAccount({
      platform: 'microsoft',
      label: item.email,
      username: item.email.split('@')[0] || '',
      email: item.email,
      password: item.password || null,
      recoveryEmail: item.recoveryEmail || '',
      refreshToken: item.refreshToken || null,
      status: 'active',
      tags: ['outlook-pool'],
      mailboxKind: 'outlook_graph',
      notes: `来自 Outlook 池 · Graph/IMAP 可收信${item.recoveryEmail ? ` · 恢复 ${item.recoveryEmail}` : ''}`,
      customFields: {
        clientId: item.clientId,
        refreshToken: item.refreshToken,
        source: 'outlook_pool'
      }
    })
    markPoolLinked(item.id, account.id)
    emails.push(item.email)
  }
  return { created: emails.length, emails }
}

async function checkOne(id: string): Promise<'alive' | 'dead' | 'error'> {
  const item = revealPoolItem(id)
  if (!item) return 'error'
  if (!item.refreshToken) {
    updatePoolStatus(id, 'dead', '缺少 refresh token')
    return 'dead'
  }
  const r = await refreshOutlookToken(item.clientId, item.refreshToken)
  if (r.ok) {
    if (r.refreshToken && r.refreshToken !== item.refreshToken) rotatePoolRefreshToken(id, r.refreshToken)
    updatePoolStatus(id, 'active', r.message)
    return 'alive'
  }
  if (r.dead) {
    updatePoolStatus(id, 'dead', r.message)
    return 'dead'
  }
  // Transient (network / throttle): leave it selectable, just record the note.
  updatePoolStatus(id, 'cooldown', r.message)
  return 'error'
}

export async function testOutlookPoolItem(id: string): Promise<{ ok: boolean; message: string }> {
  const result = await checkOne(id)
  const item = revealPoolItem(id)
  if (result === 'alive') return { ok: true, message: `${item?.email ?? ''} 令牌有效` }
  if (result === 'dead') return { ok: false, message: `${item?.email ?? ''} 已失效，已标记为死号` }
  return { ok: false, message: `${item?.email ?? ''} 暂时无法验证（网络或限流），稍后重试` }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let keepaliveRunning = false

export async function keepaliveOutlookPool(limit = 200): Promise<OutlookKeepaliveResult> {
  if (keepaliveRunning) throw new Error('保活任务正在进行，请稍候')
  keepaliveRunning = true
  const out: OutlookKeepaliveResult = { checked: 0, alive: 0, dead: 0 }
  try {
    const rows = poolItemsForCheck(limit)
    for (const row of rows) {
      const r = await checkOne(row.id)
      out.checked += 1
      if (r === 'alive') out.alive += 1
      else if (r === 'dead') out.dead += 1
      await sleep(400 + Math.random() * 600)
    }
    return out
  } finally {
    keepaliveRunning = false
  }
}

let timer: NodeJS.Timeout | null = null

/** Optional background keepalive, driven by the `outlookKeepaliveHours` setting. */
export function startOutlookKeepalive(): void {
  if (timer) return
  const tick = async (): Promise<void> => {
    const hours = getSettings().outlookKeepaliveHours
    if (hours <= 0 || keepaliveRunning) return
    const due = poolItemsDueForCheck(Date.now() - hours * 3600_000, 500)
    if (due.length === 0) return
    keepaliveRunning = true
    const out = { checked: 0, alive: 0, dead: 0 }
    try {
      for (const row of due) {
        const r = await checkOne(row.id)
        out.checked += 1
        if (r === 'alive') out.alive += 1
        else if (r === 'dead') out.dead += 1
        await sleep(400 + Math.random() * 600)
      }
      logger.info('outlook', `池保活：检查 ${out.checked}，有效 ${out.alive}，失效 ${out.dead}`)
    } finally {
      keepaliveRunning = false
    }
  }
  timer = setInterval(() => void tick(), 30 * 60_000)
  setTimeout(() => void tick(), 60_000)
}

export function stopOutlookKeepalive(): void {
  if (timer) clearInterval(timer)
  timer = null
}
