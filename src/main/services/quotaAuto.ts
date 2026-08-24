import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { Account, QuotaSyncEvent } from '@shared/types'
import { hasQuota } from '@shared/platformFlags'
import { getAccount, listAccounts, revealSecrets } from '../db/repositories/accounts'
import { refreshAccountQuota, refreshAccountQuotas } from './quota'
import { getSettings } from './settings'
import { logger } from './logger'

function broadcast(event: QuotaSyncEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.automation.quotaUpdated, event)
  }
}

/**
 * True when the account already carries something we can call an API with, so
 * a silent refresh will not just write a "not signed in" error onto the card.
 */
function hasCredential(account: Account): boolean {
  if (account.hasRefreshToken) return true
  const f = account.customFields
  if (f.sessionToken || f.sessionKey || f.apiKey || f.accessToken || f.sessionCookies) return true
  try {
    return !!revealSecrets(account.id).refreshToken
  } catch {
    return false
  }
}

const pending = new Map<string, NodeJS.Timeout>()

/**
 * Pull quota for a freshly authorized / imported account and push the result to
 * the UI, so the card fills in without the user hitting refresh.
 */
export function scheduleQuotaSync(accountId: string, delayMs = 400): void {
  const acc = getAccount(accountId)
  if (!acc || !hasQuota(acc.platform) || !hasCredential(acc)) return
  clearTimeout(pending.get(accountId))
  pending.set(
    accountId,
    setTimeout(() => {
      pending.delete(accountId)
      broadcast({ accountId, reason: 'auto', phase: 'start' })
      void refreshAccountQuota(accountId, { sync: 'auto' })
        .then((account) => broadcast({ accountId, reason: 'auto', phase: 'done', account }))
        .catch((e: Error) => {
          logger.warn('quota', `自动拉取额度失败: ${acc.label} — ${e.message}`, { accountId })
          broadcast({ accountId, reason: 'auto', phase: 'error', message: e.message })
        })
    }, delayMs)
  )
}

let timer: NodeJS.Timeout | null = null
let running = false

async function sweep(): Promise<void> {
  if (running) return
  const minutes = getSettings().quotaAutoRefreshMinutes
  if (minutes <= 0) return
  const stale = Date.now() - minutes * 60_000
  const ids = listAccounts()
    .filter((a) => hasQuota(a.platform) && hasCredential(a))
    .filter((a) => !a.quota?.fetchedAt || a.quota.fetchedAt < stale)
    .map((a) => a.id)
  if (ids.length === 0) return
  running = true
  try {
    await refreshAccountQuotas(ids, {
      onProgress: ({ account, done, total }) =>
        broadcast({ accountId: account.id, reason: 'sweep', phase: 'done', account, done, total })
    })
  } catch (e) {
    logger.warn('quota', `后台额度轮询中断: ${(e as Error).message}`)
  } finally {
    running = false
  }
}

/** Re-check every minute; each account is only re-fetched once it goes stale. */
export function startQuotaAutoRefresh(): void {
  if (timer) return
  timer = setInterval(() => void sweep(), 60_000)
  setTimeout(() => void sweep(), 15_000)
}

export function stopQuotaAutoRefresh(): void {
  if (timer) clearInterval(timer)
  timer = null
  for (const t of pending.values()) clearTimeout(t)
  pending.clear()
}
