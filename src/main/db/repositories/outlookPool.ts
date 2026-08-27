import { randomUUID } from 'node:crypto'
import { getDb } from '../index'
import { decryptField, encryptField } from '../../services/crypto'
import type { OutlookImportResult, OutlookPoolItem, OutlookPoolStats, OutlookPoolStatus } from '@shared/types'
import { splitParts, splitStockLines, looksLikeEmail, looksLikeUuid, looksLikeUrl } from '../../automation/mailbox/stock'

interface Row {
  id: string
  email: string
  password_enc: string | null
  client_id: string
  refresh_token_enc: string | null
  recovery_email: string
  recovery_password_enc: string | null
  status: string
  used_count: number
  source: string
  tags: string
  notes: string
  account_id: string | null
  last_used_at: number | null
  last_check_at: number | null
  last_result: string
  created_at: number
  updated_at: number
}

/** Full record including decrypted secrets, for main-process use only. */
export interface OutlookPoolSecret {
  id: string
  email: string
  password: string
  clientId: string
  refreshToken: string
  recoveryEmail: string
  recoveryPassword: string
}

function parseTags(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function mapRow(r: Row): OutlookPoolItem {
  return {
    id: r.id,
    email: r.email,
    clientId: r.client_id,
    recoveryEmail: r.recovery_email,
    status: r.status as OutlookPoolStatus,
    usedCount: r.used_count,
    source: r.source,
    tags: parseTags(r.tags),
    notes: r.notes,
    accountId: r.account_id ?? '',
    hasPassword: !!r.password_enc,
    hasRefreshToken: !!r.refresh_token_enc,
    hasRecoveryPassword: !!r.recovery_password_enc,
    lastUsedAt: r.last_used_at,
    lastCheckAt: r.last_check_at,
    lastResult: r.last_result,
    createdAt: r.created_at
  }
}

export interface ParsedCombo {
  email: string
  password: string
  clientId: string
  refreshToken: string
  recoveryEmail: string
  recoveryPassword: string
}

/**
 * Parse one combo line. Outlook combos are positional and `----` delimited:
 *   email----password----clientId----refreshToken               (4-seg / graph)
 *   …----recovery_email----recovery_password                     (6-seg / graph_recovery)
 * Falls back to a heuristic scan when the layout is non-standard.
 */
export function parseComboLine(line: string): ParsedCombo | null {
  const parts = splitParts(line)
  if (parts.length >= 4 && looksLikeEmail(parts[0])) {
    const [email, password, clientId, refreshToken] = parts
    if (!refreshToken) return null
    const recoveryEmail = parts.length >= 5 && looksLikeEmail(parts[4]) ? parts[4] : ''
    const recoveryPassword = recoveryEmail && parts.length >= 6 ? parts[5] : ''
    return { email, password, clientId, refreshToken, recoveryEmail, recoveryPassword }
  }
  // Heuristic fallback: locate by shape rather than position.
  const email = parts.find(looksLikeEmail) || ''
  const clientId = parts.find(looksLikeUuid) || ''
  const refreshToken =
    [...parts].reverse().find((p) => p.length > 40 && !looksLikeEmail(p) && !looksLikeUuid(p) && !looksLikeUrl(p)) || ''
  if (!email || !refreshToken) return null
  const password =
    parts.find((p) => p !== email && p !== clientId && p !== refreshToken && !looksLikeUrl(p) && p.length < 80) || ''
  const recoveryEmail = parts.filter(looksLikeEmail).find((e) => e !== email) || ''
  return { email, password, clientId, refreshToken, recoveryEmail, recoveryPassword: '' }
}

export function importCombos(text: string, source = 'import'): OutlookImportResult {
  const lines = splitStockLines(text)
  const errors: string[] = []
  let imported = 0
  let skipped = 0
  const db = getDb()
  const exists = db.prepare('SELECT id FROM outlook_pool WHERE email = ?')
  const insert = db.prepare(
    `INSERT INTO outlook_pool
       (id, email, password_enc, client_id, refresh_token_enc, recovery_email, recovery_password_enc,
        status, used_count, source, tags, notes, account_id, last_used_at, last_check_at, last_result,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unchecked', 0, ?, '[]', '', NULL, NULL, NULL, '', ?, ?)`
  )
  const now = Date.now()
  const tx = db.transaction(() => {
    for (const [i, line] of lines.entries()) {
      const combo = parseComboLine(line)
      if (!combo) {
        errors.push(`第 ${i + 1} 行无法解析（需 email----password----clientId----refreshToken）`)
        continue
      }
      if (exists.get(combo.email)) {
        skipped += 1
        continue
      }
      insert.run(
        randomUUID(),
        combo.email,
        encryptField(combo.password || null),
        combo.clientId,
        encryptField(combo.refreshToken),
        combo.recoveryEmail,
        encryptField(combo.recoveryPassword || null),
        source,
        now,
        now
      )
      imported += 1
    }
  })
  tx()
  return { imported, skipped, errors: errors.slice(0, 20) }
}

export function listPool(): OutlookPoolItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM outlook_pool ORDER BY created_at DESC LIMIT 1000')
    .all() as Row[]
  return rows.map(mapRow)
}

export function poolStats(): OutlookPoolStats {
  const rows = getDb().prepare('SELECT status, COUNT(*) AS n FROM outlook_pool GROUP BY status').all() as {
    status: string
    n: number
  }[]
  const by = new Map(rows.map((r) => [r.status, r.n]))
  const get = (s: string): number => by.get(s) ?? 0
  return {
    total: [...by.values()].reduce((a, b) => a + b, 0),
    active: get('active'),
    dead: get('dead'),
    unchecked: get('unchecked'),
    cooldown: get('cooldown'),
    inUse: get('in_use')
  }
}

function rawById(id: string): Row | undefined {
  return getDb().prepare('SELECT * FROM outlook_pool WHERE id = ?').get(id) as Row | undefined
}

export function revealPoolItem(id: string): OutlookPoolSecret | null {
  const r = rawById(id)
  if (!r) return null
  return {
    id: r.id,
    email: r.email,
    password: decryptField(r.password_enc) ?? '',
    clientId: r.client_id,
    refreshToken: decryptField(r.refresh_token_enc) ?? '',
    recoveryEmail: r.recovery_email,
    recoveryPassword: decryptField(r.recovery_password_enc) ?? ''
  }
}

/** Least-recently-used healthy account, excluding dead / in-use rows. */
export function allocateFromPool(): OutlookPoolSecret | null {
  const r = getDb()
    .prepare(
      `SELECT * FROM outlook_pool
       WHERE status IN ('active', 'unchecked')
       ORDER BY used_count ASC, COALESCE(last_used_at, 0) ASC, created_at ASC
       LIMIT 1`
    )
    .get() as Row | undefined
  if (!r) return null
  getDb()
    .prepare('UPDATE outlook_pool SET used_count = used_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?')
    .run(Date.now(), Date.now(), r.id)
  return revealPoolItem(r.id)
}

export function markPoolLinked(id: string, accountId: string): void {
  getDb()
    .prepare("UPDATE outlook_pool SET account_id = ?, status = 'in_use', updated_at = ? WHERE id = ?")
    .run(accountId, Date.now(), id)
}

export function updatePoolStatus(id: string, status: OutlookPoolStatus, result = ''): void {
  getDb()
    .prepare('UPDATE outlook_pool SET status = ?, last_check_at = ?, last_result = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), result, Date.now(), id)
}

export function rotatePoolRefreshToken(id: string, refreshToken: string): void {
  getDb()
    .prepare('UPDATE outlook_pool SET refresh_token_enc = ?, updated_at = ? WHERE id = ?')
    .run(encryptField(refreshToken), Date.now(), id)
}

export function setPoolMeta(ids: string[], patch: { tags?: string[]; notes?: string }): void {
  const tx = getDb().transaction(() => {
    for (const id of ids) {
      const cur = rawById(id)
      if (!cur) continue
      const tags = patch.tags !== undefined ? JSON.stringify(patch.tags) : cur.tags
      const notes = patch.notes !== undefined ? patch.notes : cur.notes
      getDb().prepare('UPDATE outlook_pool SET tags = ?, notes = ?, updated_at = ? WHERE id = ?').run(tags, notes, Date.now(), id)
    }
  })
  tx()
}

export function removePoolItems(ids: string[]): number {
  const stmt = getDb().prepare('DELETE FROM outlook_pool WHERE id = ?')
  let n = 0
  const tx = getDb().transaction(() => {
    for (const id of ids) n += stmt.run(id).changes as number
  })
  tx()
  return n
}

export function purgeDeadPool(): number {
  return getDb().prepare("DELETE FROM outlook_pool WHERE status = 'dead'").run().changes as number
}

/** Rows to keepalive: active or never-checked, oldest check first. */
export function poolItemsForCheck(limit: number): { id: string }[] {
  return getDb()
    .prepare(
      `SELECT id FROM outlook_pool
       WHERE status IN ('active', 'unchecked', 'cooldown')
       ORDER BY COALESCE(last_check_at, 0) ASC
       LIMIT ?`
    )
    .all(limit) as { id: string }[]
}

/** Same, but only rows whose last check is older than `before` (or never checked). */
export function poolItemsDueForCheck(before: number, limit: number): { id: string }[] {
  return getDb()
    .prepare(
      `SELECT id FROM outlook_pool
       WHERE status IN ('active', 'unchecked', 'cooldown')
         AND COALESCE(last_check_at, 0) < ?
       ORDER BY COALESCE(last_check_at, 0) ASC
       LIMIT ?`
    )
    .all(before, limit) as { id: string }[]
}

/** Build combo lines for export. */
export function exportCombos(ids: string[] | undefined, sixSegment: boolean): string {
  const rows = (
    ids && ids.length
      ? ids.map((id) => rawById(id)).filter((r): r is Row => !!r)
      : (getDb().prepare('SELECT * FROM outlook_pool ORDER BY created_at DESC').all() as Row[])
  ).map((r) => revealPoolItem(r.id)!)
  return rows
    .map((r) => {
      const base = [r.email, r.password, r.clientId, r.refreshToken]
      if (sixSegment) base.push(r.recoveryEmail, r.recoveryPassword)
      return base.join('----')
    })
    .join('\n')
}
