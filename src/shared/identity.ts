export interface BrowserIdentity {
  userAgent: string
  locale: string
  timezone: string
}

const CHROME = (os: string, ver: string): string =>
  `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`

const WIN = 'Windows NT 10.0; Win64; x64'
const MAC = 'Macintosh; Intel Mac OS X 10_15_7'

const PROFILES: BrowserIdentity[] = [
  { userAgent: CHROME(WIN, '126.0.0.0'), locale: 'en-US', timezone: 'America/New_York' },
  { userAgent: CHROME(WIN, '125.0.0.0'), locale: 'en-GB', timezone: 'Europe/London' },
  { userAgent: CHROME(MAC, '126.0.0.0'), locale: 'en-US', timezone: 'America/Los_Angeles' },
  { userAgent: CHROME(WIN, '124.0.0.0'), locale: 'de-DE', timezone: 'Europe/Berlin' },
  { userAgent: CHROME(MAC, '125.0.0.0'), locale: 'ja-JP', timezone: 'Asia/Tokyo' },
  { userAgent: CHROME(WIN, '126.0.0.0'), locale: 'zh-CN', timezone: 'Asia/Shanghai' },
  { userAgent: CHROME(WIN, '125.0.0.0'), locale: 'fr-FR', timezone: 'Europe/Paris' }
]

export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney'
]

export function randomIdentity(): BrowserIdentity {
  return PROFILES[Math.floor(Math.random() * PROFILES.length)]
}

const PLACEHOLDER =
  /^(cursor|openai|anthropic|kiro|windsurf|grok|antigravity|google|github|microsoft|apple|x|youtube|discord|custom)(\s*授权中)?$/i

export function isPlaceholderLabel(label: string, platform?: string): boolean {
  const l = label.trim()
  if (!l) return true
  if (PLACEHOLDER.test(l)) return true
  if (platform && l.toLowerCase() === platform.toLowerCase()) return true
  if (/授权中$/.test(l)) return true
  return false
}

export function normalizeLoginMethod(raw?: string): string {
  const m = (raw || '').toLowerCase()
  if (!m) return ''
  if (m.includes('google')) return 'google'
  if (m.includes('github')) return 'github'
  if (m.includes('apple')) return 'apple'
  if (m.includes('microsoft') || m.includes('azure') || m.includes('hotmail') || m.includes('outlook')) {
    return 'microsoft'
  }
  if (m.includes('twitter') || m === 'x' || m.includes('x.com')) return 'x'
  if (m.includes('discord')) return 'discord'
  if (m.includes('password') || m.includes('email') || m.includes('auth_0') || m.includes('auth0')) return 'email'
  if (m.includes('token') || m.includes('api')) return 'token'
  if (m.includes('oauth') || m.includes('sso') || m.includes('workos')) return 'oauth'
  return ''
}

export function loginMethodShort(method?: string): string {
  const m = normalizeLoginMethod(method)
  if (m === 'google') return 'Google'
  if (m === 'github') return 'GitHub'
  if (m === 'apple') return 'Apple'
  if (m === 'microsoft') return 'Microsoft'
  if (m === 'x') return 'X'
  if (m === 'discord') return 'Discord'
  if (m === 'email') return '邮箱'
  if (m === 'token') return 'Token'
  if (m === 'oauth') return '授权'
  return ''
}

export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

function emailFromObject(o: Record<string, unknown>): string {
  return pickEmail(
    o.email,
    o.user_email,
    o.userEmail,
    o.emailAddress,
    o.customerEmail,
    o.primaryEmail,
    o.loginEmail,
    o.preferred_username,
    o.authId,
    o.username,
    o.user,
    o.account,
    o.customer
  )
}

export function scanEmail(v: unknown, depth = 0): string {
  if (depth > 5 || v == null) return ''
  if (typeof v === 'string') return looksLikeEmail(v) ? v.trim() : ''
  if (Array.isArray(v)) {
    for (const item of v) {
      const hit = scanEmail(item, depth + 1)
      if (hit) return hit
    }
    return ''
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const preferred = emailFromObject(o)
    if (preferred) return preferred
    for (const item of Object.values(o)) {
      const hit = scanEmail(item, depth + 1)
      if (hit) return hit
    }
  }
  return ''
}

export function pickEmail(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && looksLikeEmail(v)) return v.trim()
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = emailFromObject(v as Record<string, unknown>)
      if (nested) return nested
    }
  }
  return ''
}

export function accountIdentityTitle(a: {
  label: string
  email: string
  username: string
  platform?: string
}): string {
  if (looksLikeEmail(a.email)) return a.email.trim()
  if (looksLikeEmail(a.username)) return a.username.trim()
  if (!isPlaceholderLabel(a.label, a.platform) && a.label.trim()) return a.label.trim()
  if (a.username.trim() && !isPlaceholderLabel(a.username, a.platform)) return a.username.trim()
  return '已授权（待同步邮箱）'
}

export function tokenFingerprint(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  return v.length > 32 ? v.slice(-32) : v
}
