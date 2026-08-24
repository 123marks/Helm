import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getDb } from '../index'
import { paths } from '../../paths'
import { encryptField, decryptField } from '../../services/crypto'
import { relocatedProfileDirs } from '../../services/dataMigration'
import type {
  Account,
  AccountInput,
  AccountQuota,
  AccountSecrets,
  AccountStatus,
  PasswordHistoryEntry,
  Platform
} from '@shared/types'
import { randomIdentity } from '@shared/identity'

interface AccountRow {
  id: string
  platform: string
  label: string
  username: string
  email: string
  password_enc: string | null
  totp_secret_enc: string | null
  recovery_email: string
  recovery_phone: string
  backup_codes_enc: string | null
  refresh_token_enc: string | null
  custom_fields: string
  group_name: string
  tags: string
  status: string
  favorite: number
  deleted_at: number | null
  profile_dir: string
  proxy_url: string | null
  user_agent: string | null
  locale: string | null
  timezone: string | null
  notes: string
  last_used_at: number | null
  created_at: number
  updated_at: number
  password_updated_at: number | null
  oauth_provider?: string | null
  oauth_source_account_id?: string | null
  mailbox_kind?: string | null
  mailbox_pass_enc?: string | null
  mailbox_client_id?: string | null
  quota_json?: string | null
}

function safeParseObj(s: string): Record<string, string> {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function safeParseArr(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function parseQuota(raw: string | null | undefined): AccountQuota | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as AccountQuota
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

function normalizeSecret(secret: string | null | undefined): string | null {
  if (!secret) return null
  return secret.replace(/\s+/g, '').toUpperCase()
}

function mapRow(r: AccountRow): Account {
  return {
    id: r.id,
    platform: r.platform as Platform,
    label: r.label,
    username: r.username,
    email: r.email,
    hasPassword: !!r.password_enc,
    hasTotp: !!r.totp_secret_enc,
    recoveryEmail: r.recovery_email,
    recoveryPhone: r.recovery_phone,
    hasBackupCodes: !!r.backup_codes_enc,
    hasRefreshToken: !!r.refresh_token_enc,
    customFields: safeParseObj(r.custom_fields),
    groupName: r.group_name,
    tags: safeParseArr(r.tags),
    status: r.status as AccountStatus,
    favorite: !!r.favorite,
    profileDir: r.profile_dir,
    proxyUrl: r.proxy_url ?? '',
    userAgent: r.user_agent ?? '',
    locale: r.locale ?? '',
    timezone: r.timezone ?? '',
    notes: r.notes,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    oauthProvider: r.oauth_provider ?? '',
    oauthSourceAccountId: r.oauth_source_account_id ?? '',
    mailboxKind: r.mailbox_kind ?? '',
    mailboxClientId: r.mailbox_client_id ?? '',
    hasMailboxPass: !!r.mailbox_pass_enc,
    quota: parseQuota(r.quota_json)
  }
}

function rawRow(id: string): AccountRow | undefined {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined
}

function buildWrite(input: Partial<AccountInput>): Record<string, unknown> {
  const w: Record<string, unknown> = {}
  if (input.platform !== undefined) w.platform = input.platform
  if (input.label !== undefined) w.label = input.label
  if (input.username !== undefined) w.username = input.username
  if (input.email !== undefined) w.email = input.email
  if (input.password !== undefined) {
    w.password_enc = encryptField(input.password)
    w.password_updated_at = input.password ? Date.now() : null
  }
  if (input.totpSecret !== undefined) w.totp_secret_enc = encryptField(normalizeSecret(input.totpSecret))
  if (input.recoveryEmail !== undefined) w.recovery_email = input.recoveryEmail
  if (input.recoveryPhone !== undefined) w.recovery_phone = input.recoveryPhone
  if (input.backupCodes !== undefined) {
    w.backup_codes_enc =
      input.backupCodes && input.backupCodes.length
        ? encryptField(JSON.stringify(input.backupCodes))
        : null
  }
  if (input.refreshToken !== undefined) w.refresh_token_enc = encryptField(input.refreshToken)
  if (input.customFields !== undefined) w.custom_fields = JSON.stringify(input.customFields ?? {})
  if (input.groupName !== undefined) w.group_name = input.groupName
  if (input.tags !== undefined) w.tags = JSON.stringify(input.tags ?? [])
  if (input.status !== undefined) w.status = input.status
  if (input.favorite !== undefined) w.favorite = input.favorite ? 1 : 0
  if (input.proxyUrl !== undefined) w.proxy_url = input.proxyUrl || null
  if (input.userAgent !== undefined) w.user_agent = input.userAgent || null
  if (input.locale !== undefined) w.locale = input.locale || null
  if (input.timezone !== undefined) w.timezone = input.timezone || null
  if (input.notes !== undefined) w.notes = input.notes
  if (input.oauthProvider !== undefined) w.oauth_provider = input.oauthProvider || null
  if (input.oauthSourceAccountId !== undefined) w.oauth_source_account_id = input.oauthSourceAccountId || null
  if (input.mailboxKind !== undefined) w.mailbox_kind = input.mailboxKind || null
  if (input.mailboxAppPassword !== undefined) w.mailbox_pass_enc = encryptField(input.mailboxAppPassword)
  if (input.mailboxClientId !== undefined) w.mailbox_client_id = input.mailboxClientId || null
  if (input.quota !== undefined) w.quota_json = input.quota ? JSON.stringify(input.quota) : null
  return w
}

export function listAccounts(): Account[] {
  const rows = getDb()
    .prepare('SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY favorite DESC, created_at DESC')
    .all() as AccountRow[]
  return rows.map(mapRow)
}

export function getAccount(id: string): Account | null {
  const r = rawRow(id)
  return r ? mapRow(r) : null
}

/**
 * Chrome profile paths are absolute, so they go stale when the data directory
 * moves (app rename, machine migration). Re-point the rows that clearly belong
 * under the current profiles root.
 */
export function repairProfileDirs(): number {
  const rows = getDb().prepare('SELECT id, profile_dir FROM accounts').all() as {
    id: string
    profile_dir: string
  }[]
  const fixes = relocatedProfileDirs(
    paths().profiles,
    rows.map((r) => ({ id: r.id, profileDir: r.profile_dir }))
  )
  if (fixes.length === 0) return 0
  const stmt = getDb().prepare('UPDATE accounts SET profile_dir = ? WHERE id = ?')
  getDb().transaction(() => {
    for (const f of fixes) stmt.run(f.profileDir, f.id)
  })()
  return fixes.length
}

export function createAccount(input: AccountInput): Account {
  const id = randomUUID()
  const now = Date.now()
  const ident = input.userAgent?.trim() ? null : randomIdentity()
  const payload: AccountInput = ident
    ? {
        ...input,
        userAgent: ident.userAgent,
        locale: input.locale || ident.locale,
        timezone: input.timezone || ident.timezone
      }
    : input
  const w = buildWrite(payload)
  const record = {
    id,
    platform: (w.platform as string) ?? input.platform ?? 'custom',
    label: (w.label as string) ?? '',
    username: (w.username as string) ?? '',
    email: (w.email as string) ?? '',
    password_enc: (w.password_enc as string | null) ?? null,
    totp_secret_enc: (w.totp_secret_enc as string | null) ?? null,
    recovery_email: (w.recovery_email as string) ?? '',
    recovery_phone: (w.recovery_phone as string) ?? '',
    backup_codes_enc: (w.backup_codes_enc as string | null) ?? null,
    refresh_token_enc: (w.refresh_token_enc as string | null) ?? null,
    custom_fields: (w.custom_fields as string) ?? '{}',
    group_name: (w.group_name as string) ?? '',
    tags: (w.tags as string) ?? '[]',
    status: (w.status as string) ?? 'active',
    favorite: (w.favorite as number) ?? 0,
    profile_dir: join(paths().profiles, id),
    proxy_url: (w.proxy_url as string | null) ?? null,
    user_agent: (w.user_agent as string | null) ?? null,
    locale: (w.locale as string | null) ?? null,
    timezone: (w.timezone as string | null) ?? null,
    notes: (w.notes as string) ?? '',
    last_used_at: null as number | null,
    created_at: now,
    updated_at: now,
    password_updated_at: (w.password_updated_at as number | null) ?? (input.password ? now : null),
    oauth_provider: (w.oauth_provider as string | null) ?? null,
    oauth_source_account_id: (w.oauth_source_account_id as string | null) ?? null,
    mailbox_kind: (w.mailbox_kind as string | null) ?? null,
    mailbox_pass_enc: (w.mailbox_pass_enc as string | null) ?? null,
    mailbox_client_id: (w.mailbox_client_id as string | null) ?? null,
    quota_json: (w.quota_json as string | null) ?? null
  }
  getDb()
    .prepare(
      `INSERT INTO accounts (
        id, platform, label, username, email, password_enc, totp_secret_enc,
        recovery_email, recovery_phone, backup_codes_enc, refresh_token_enc,
        custom_fields, group_name, tags, status, favorite, profile_dir, proxy_url,
        user_agent, locale, timezone, notes,
        last_used_at, created_at, updated_at, password_updated_at,
        oauth_provider, oauth_source_account_id,
        mailbox_kind, mailbox_pass_enc, mailbox_client_id, quota_json
      ) VALUES (
        @id, @platform, @label, @username, @email, @password_enc, @totp_secret_enc,
        @recovery_email, @recovery_phone, @backup_codes_enc, @refresh_token_enc,
        @custom_fields, @group_name, @tags, @status, @favorite, @profile_dir, @proxy_url,
        @user_agent, @locale, @timezone, @notes,
        @last_used_at, @created_at, @updated_at, @password_updated_at,
        @oauth_provider, @oauth_source_account_id,
        @mailbox_kind, @mailbox_pass_enc, @mailbox_client_id, @quota_json
      )`
    )
    .run(record)
  return getAccount(id)!
}

export function updateAccount(id: string, patch: Partial<AccountInput>): Account {
  // Archive the previous password (encrypted) and apply the update atomically so
  // a crash can't leave history and the new value out of sync.
  const tx = getDb().transaction(() => {
    if (patch.password !== undefined) {
      const cur = rawRow(id)
      const oldPw = cur ? decryptField(cur.password_enc) : null
      const newPw = patch.password || null
      if (oldPw && oldPw !== newPw) {
        getDb()
          .prepare('INSERT INTO password_history (account_id, password_enc, changed_at) VALUES (?, ?, ?)')
          .run(id, encryptField(oldPw), Date.now())
      }
    }
    const w = buildWrite(patch)
    if (Object.keys(w).length > 0) {
      w.updated_at = Date.now()
      const setClause = Object.keys(w)
        .map((k) => `${k} = @${k}`)
        .join(', ')
      getDb()
        .prepare(`UPDATE accounts SET ${setClause} WHERE id = @id`)
        .run({ ...w, id })
    }
  })
  tx()
  const acc = getAccount(id)
  if (!acc) throw new Error('Account not found: ' + id)
  return acc
}

/** Move an account to the recycle bin (recoverable). */
export function softDeleteAccount(id: string): void {
  getDb().prepare('UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), id)
}

/** Restore a soft-deleted account. */
export function restoreAccount(id: string): void {
  getDb().prepare('UPDATE accounts SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(Date.now(), id)
}

/** Accounts currently in the recycle bin (most recently deleted first). */
export function listDeletedAccounts(): Account[] {
  const rows = getDb()
    .prepare('SELECT * FROM accounts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')
    .all() as AccountRow[]
  return rows.map(mapRow)
}

/** Permanently delete a single account (and its password history). */
export function deleteAccount(id: string): void {
  getDb().prepare('DELETE FROM password_history WHERE account_id = ?').run(id)
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

/** Permanently delete everything in the recycle bin. Returns the count removed. */
export function purgeDeletedAccounts(): number {
  const ids = (
    getDb().prepare('SELECT id FROM accounts WHERE deleted_at IS NOT NULL').all() as { id: string }[]
  ).map((r) => r.id)
  const tx = getDb().transaction(() => {
    for (const id of ids) {
      getDb().prepare('DELETE FROM password_history WHERE account_id = ?').run(id)
      getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
    }
  })
  tx()
  return ids.length
}

function maskPreview(pw: string): string {
  if (!pw) return ''
  if (pw.length <= 2) return '•'.repeat(pw.length)
  const dots = '•'.repeat(Math.min(pw.length - 2, 8))
  return `${pw[0]}${dots}${pw[pw.length - 1]}`
}

interface PasswordHistoryRow {
  id: number
  changed_at: number
  password_enc: string
}

/** Previous passwords for an account (newest first), with masked previews only. */
export function listPasswordHistory(accountId: string): PasswordHistoryEntry[] {
  const rows = getDb()
    .prepare(
      'SELECT id, changed_at, password_enc FROM password_history WHERE account_id = ? ORDER BY changed_at DESC'
    )
    .all(accountId) as PasswordHistoryRow[]
  return rows.map((r) => ({
    id: r.id,
    changedAt: r.changed_at,
    preview: maskPreview(decryptField(r.password_enc) ?? '')
  }))
}

/** Decrypt a single history entry (for copy / restore). */
export function revealPasswordHistory(historyId: number): string {
  const r = getDb()
    .prepare('SELECT password_enc FROM password_history WHERE id = ?')
    .get(historyId) as { password_enc: string } | undefined
  return r ? decryptField(r.password_enc) ?? '' : ''
}

/** Set the account's password back to a historical value (archives the current one). */
export function restorePassword(accountId: string, historyId: number): void {
  const pw = revealPasswordHistory(historyId)
  if (!pw) throw new Error('历史密码不存在')
  updateAccount(accountId, { password: pw })
}

export function touchLastUsed(id: string): void {
  getDb().prepare('UPDATE accounts SET last_used_at = ? WHERE id = ?').run(Date.now(), id)
}

export function revealSecrets(id: string): AccountSecrets {
  const r = rawRow(id)
  if (!r) throw new Error('Account not found: ' + id)
  return {
    password: decryptField(r.password_enc),
    totpSecret: decryptField(r.totp_secret_enc),
    backupCodes: r.backup_codes_enc
      ? (JSON.parse(decryptField(r.backup_codes_enc) ?? '[]') as string[])
      : [],
    refreshToken: decryptField(r.refresh_token_enc),
    mailboxAppPassword: decryptField(r.mailbox_pass_enc)
  }
}

export function getAccountForAutomation(
  id: string
): { account: Account; secrets: AccountSecrets } | null {
  const account = getAccount(id)
  if (!account) return null
  return { account, secrets: revealSecrets(id) }
}

export function exportAll(ids?: string[]): string {
  const all = getDb()
    .prepare('SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at ASC')
    .all() as AccountRow[]
  const rows = ids && ids.length ? all.filter((r) => ids.includes(r.id)) : all
  const accounts = rows.map((r) => ({
    platform: r.platform,
    label: r.label,
    username: r.username,
    email: r.email,
    password: decryptField(r.password_enc),
    totpSecret: decryptField(r.totp_secret_enc),
    recoveryEmail: r.recovery_email,
    recoveryPhone: r.recovery_phone,
    backupCodes: r.backup_codes_enc
      ? (JSON.parse(decryptField(r.backup_codes_enc) ?? '[]') as string[])
      : [],
    refreshToken: decryptField(r.refresh_token_enc),
    customFields: safeParseObj(r.custom_fields),
    groupName: r.group_name,
    tags: safeParseArr(r.tags),
    status: r.status,
    favorite: !!r.favorite,
    proxyUrl: r.proxy_url ?? '',
    userAgent: r.user_agent ?? '',
    locale: r.locale ?? '',
    timezone: r.timezone ?? '',
    notes: r.notes,
    mailboxKind: r.mailbox_kind ?? '',
    mailboxAppPassword: decryptField(r.mailbox_pass_enc),
    mailboxClientId: r.mailbox_client_id ?? '',
    quota: parseQuota(r.quota_json)
  }))
  return JSON.stringify({ version: 1, exportedAt: Date.now(), accounts }, null, 2)
}

export function importJson(json: string): number {
  const data = JSON.parse(json)
  const arr: unknown[] = Array.isArray(data) ? data : data?.accounts
  if (!Array.isArray(arr)) throw new Error('Invalid import format: expected an array of accounts')
  let count = 0
  const tx = getDb().transaction(() => {
    for (const item of arr) {
      const a = item as Partial<AccountInput> & { platform?: string }
      createAccount({
        platform: (a.platform as Platform) ?? 'custom',
        label: a.label ?? a.username ?? a.email ?? 'imported',
        username: a.username ?? '',
        email: a.email ?? '',
        password: a.password ?? null,
        totpSecret: a.totpSecret ?? null,
        recoveryEmail: a.recoveryEmail ?? '',
        recoveryPhone: a.recoveryPhone ?? '',
        backupCodes: a.backupCodes ?? [],
        refreshToken: a.refreshToken ?? null,
        customFields: a.customFields ?? {},
        groupName: a.groupName ?? '',
        tags: a.tags ?? [],
        status: (a.status as AccountStatus) ?? 'active',
        favorite: !!a.favorite,
        proxyUrl: a.proxyUrl ?? '',
        userAgent: a.userAgent ?? '',
        locale: a.locale ?? '',
        timezone: a.timezone ?? '',
        notes: a.notes ?? '',
        mailboxKind: a.mailboxKind ?? '',
        mailboxAppPassword: a.mailboxAppPassword ?? null,
        mailboxClientId: a.mailboxClientId ?? '',
        quota: a.quota ?? null
      })
      count++
    }
  })
  tx()
  return count
}
