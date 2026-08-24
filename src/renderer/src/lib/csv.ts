// Dependency-free CSV import helpers. Parses arbitrary CSV exports from
// browsers and password managers (Chrome/Edge, Bitwarden, 1Password, KeePass,
// LastPass, …) into the app's plaintext import objects, which the main process
// then re-encrypts via accounts.importJson.

import type { Platform } from '@shared/types'

export interface ImportAccount {
  platform: Platform
  label: string
  username: string
  email: string
  password: string
  totpSecret: string
  recoveryEmail: string
  notes: string
  groupName: string
  tags: string[]
}

export interface CsvMapResult {
  accounts: ImportAccount[]
  total: number
  skipped: number
}

/** Serialize rows to CSV, quoting cells that contain commas, quotes or newlines. */
export function toCsv(headers: string[], rows: Array<Record<string, string>>): string {
  const esc = (v: string): string => {
    const s = v ?? ''
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = headers.map(esc).join(',')
  const body = rows.map((r) => headers.map((h) => esc(r[h] ?? '')).join(',')).join('\n')
  return `${head}\n${body}`
}

/** Parse CSV text into rows of string cells (handles quotes, embedded commas/newlines, CRLF, BOM). */
export function parseCsv(input: string): string[][] {
  let text = input
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip BOM
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  const n = text.length
  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    rows.push(row)
    row = []
  }
  for (let i = 0; i < n; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === ',') pushField()
    else if (c === '\r') continue
    else if (c === '\n') {
      pushField()
      pushRow()
    } else field += c
  }
  if (field.length > 0 || row.length > 0) {
    pushField()
    pushRow()
  }
  // Drop fully-empty rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Ordered most-specific first so youtube isn't swallowed by google, etc.
const DOMAIN_PLATFORM: Array<[RegExp, Platform]> = [
  [/github\.com/i, 'github'],
  [/(?:^|\.)x\.com|twitter\.com/i, 'x'],
  [/youtube\.com|youtu\.be/i, 'youtube'],
  [/chatgpt\.com|openai\.com/i, 'openai'],
  [/claude\.ai|anthropic\.com/i, 'anthropic'],
  [/cursor\.(?:com|so|sh)/i, 'cursor'],
  [/codeium\.com|windsurf/i, 'windsurf'],
  [/kiro\.dev|kiro/i, 'kiro'],
  [/grok\.com|x\.ai|xai/i, 'grok'],
  [/antigravity\.google|cloudcode-pa/i, 'antigravity'],
  [/discord\.(?:com|gg)/i, 'discord'],
  [/icloud\.com|apple\.com/i, 'apple'],
  [/live\.com|outlook\.|office\.com|microsoftonline\.com|microsoft\.com/i, 'microsoft'],
  [/accounts\.google\.|gmail\.com|google\.com/i, 'google']
]

/** Best-effort platform inference from a URL + title haystack. */
export function inferPlatform(haystack: string): Platform {
  for (const [re, p] of DOMAIN_PLATFORM) if (re.test(haystack)) return p
  return 'custom'
}

// Canonical field -> list of accepted header aliases (lowercased).
const HEADER_ALIASES: Record<string, string[]> = {
  label: ['name', 'title', 'account', 'item', 'entry', 'entry name', 'display name'],
  url: ['url', 'uri', 'website', 'web site', 'login_uri', 'login uri', 'site', 'link', 'urls'],
  username: [
    'username',
    'user name',
    'login',
    'login name',
    'login_username',
    'user',
    'account name',
    'userid',
    'user id'
  ],
  email: ['email', 'e-mail', 'mail', 'email address'],
  password: ['password', 'pass', 'login_password', 'pwd', 'passwd'],
  totp: [
    'otpauth',
    'otp',
    'totp',
    'login_totp',
    '2fa',
    'authenticator key',
    'otp secret',
    'one-time password',
    'totp secret',
    'verification'
  ],
  notes: ['notes', 'note', 'comment', 'comments', 'extra'],
  group: ['folder', 'group', 'category', 'collection', 'grouping']
}

function buildHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {}
  headers.forEach((h, i) => {
    const key = h.trim().toLowerCase()
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[canonical] === undefined && aliases.includes(key)) map[canonical] = i
    }
  })
  return map
}

/** Pull the base32 secret out of an otpauth:// URI, else return the value as-is. */
export function extractTotpSecret(value: string): string {
  const v = value.trim()
  if (/^otpauth:\/\//i.test(v)) {
    const m = v.match(/[?&]secret=([^&]+)/i)
    return m ? decodeURIComponent(m[1]) : ''
  }
  return v
}

/**
 * Map parsed CSV rows to import accounts. Requires a header row that contains at
 * least one recognizable credential column (username/email/password); throws a
 * clear error otherwise.
 */
export function mapCsv(rows: string[][]): CsvMapResult {
  if (rows.length < 2) throw new Error('CSV 内容为空或只有表头')
  const headers = rows[0]
  const hmap = buildHeaderMap(headers)
  if (
    hmap.password === undefined &&
    hmap.username === undefined &&
    hmap.email === undefined &&
    hmap.totp === undefined
  ) {
    throw new Error('无法识别列名，请确认这是浏览器 / 密码管理器导出的标准 CSV')
  }

  const at = (row: string[], key: string): string => {
    const idx = hmap[key]
    return idx === undefined ? '' : (row[idx] ?? '').trim()
  }

  const accounts: ImportAccount[] = []
  let skipped = 0
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const url = at(row, 'url')
    const rawUser = at(row, 'username')
    let email = at(row, 'email')
    const password = at(row, 'password')
    const totp = extractTotpSecret(at(row, 'totp'))
    const notes = at(row, 'notes')
    const group = at(row, 'group')
    let label = at(row, 'label')

    if (!rawUser && !email && !password && !totp) {
      skipped++
      continue
    }
    if (!email && EMAIL_RE.test(rawUser)) email = rawUser
    if (!label) label = rawUser || email || (url ? hostOf(url) : '') || 'imported'

    accounts.push({
      platform: inferPlatform(`${url} ${label}`),
      label,
      username: rawUser,
      email,
      password,
      totpSecret: totp,
      recoveryEmail: '',
      notes: url && notes ? `${url}\n${notes}` : url || notes,
      groupName: group,
      tags: []
    })
  }
  return { accounts, total: rows.length - 1, skipped }
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
