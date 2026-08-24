import type { AccountInput, Platform } from './types'

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : ''
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = str(obj[k])
    if (v) return v
  }
  return ''
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const pad = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4)
    const json =
      typeof Buffer !== 'undefined'
        ? Buffer.from(padded, 'base64').toString('utf8')
        : decodeURIComponent(
            Array.from(atob(padded), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
          )
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export function jwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  return b64urlJson(parts[1])
}

export function normalizeCursorSession(raw: string): {
  userId: string
  jwt: string
  cookieValue: string
  headerValue: string
} | null {
  let v = raw.trim().replace(/^WorkosCursorSessionToken=/i, '')
  if (/%3A%3A/i.test(v)) {
    try {
      v = decodeURIComponent(v)
    } catch {
      /* keep encoded */
    }
  }
  let userId = ''
  let jwt = ''
  const idx = v.indexOf('::')
  if (idx > 0) {
    userId = v.slice(0, idx).trim()
    jwt = v.slice(idx + 2).trim()
  } else if (v.startsWith('eyJ')) {
    jwt = v
    const p = jwtPayload(jwt)
    const sub = str(p?.sub || p?.user_id)
    userId = sub.includes('|') ? sub.split('|').pop() || sub : sub
  }
  if (!jwt.startsWith('eyJ')) return null
  if (!userId) userId = 'user'
  return {
    userId,
    jwt,
    cookieValue: `${userId}::${jwt}`,
    headerValue: `${encodeURIComponent(userId)}%3A%3A${jwt}`
  }
}

function inferPlatform(obj: Record<string, unknown>, email: string, token = ''): Platform | '' {
  const blob = `${JSON.stringify(obj)}\n${token}`.toLowerCase()
  if (/sk-ant-sid0|sessionkey|claude\.ai|anthropic/.test(blob)) return 'anthropic'
  if (/sk-ws-01|codeium|windsurf/.test(blob)) return 'windsurf'
  if (/workoscursorsessiontoken|cursor\.com|user_\w+::/.test(blob)) return 'cursor'
  if (/kiro|builderid|oidc\.|clientsecret|codewhisperer/.test(blob)) return 'kiro'
  if (/chatgpt|openai|__secure-next-auth/.test(blob)) return 'openai'
  if (/xai-|grok\.com|accounts\.x\.ai|supergrok/.test(blob)) return 'grok'
  if (/antigravity|cloudcode-pa|cloudaicompanion|availablepromptcredits/.test(blob)) return 'antigravity'
  if (/@/.test(email) && /gmail\.com|google/.test(email)) return 'google'
  return ''
}

function emptyInput(platform: Platform, token: string, extra?: Partial<AccountInput>): AccountInput {
  const email = extra?.email || ''
  const local = email.split('@')[0] || platform
  return {
    platform,
    label: extra?.label || local,
    username: extra?.username || local,
    email,
    refreshToken: token || extra?.refreshToken || null,
    mailboxClientId: extra?.mailboxClientId,
    customFields: extra?.customFields || {},
    notes: extra?.notes || `从 ${platform} Token 导入`,
    status: extra?.status || 'active',
    tags: extra?.tags || ['token-import']
  }
}

function fromCookiesArray(cookies: unknown[], hint?: Platform): AccountInput | null {
  const rows = cookies.filter((c) => asObj(c)) as Record<string, unknown>[]
  if (!rows.length) return null
  const byName = new Map(rows.map((c) => [str(c.name).toLowerCase(), str(c.value)]))
  const sessionCookies = JSON.stringify(
    rows.map((c) => ({
      name: str(c.name),
      value: str(c.value),
      domain: str(c.domain),
      path: str(c.path) || '/',
      secure: c.secure !== false,
      httpOnly: !!c.httpOnly,
      sameSite: str(c.sameSite) || 'Lax',
      expires: typeof c.expires === 'number' ? c.expires : undefined
    }))
  )
  const cursor = byName.get('workoscursorsessiontoken')
  const claude = byName.get('sessionkey')
  const org = byName.get('lastactiveorg')
  const gpt =
    byName.get('__secure-next-auth.session-token') ||
    byName.get('__host-next-auth.session-token') ||
    byName.get('session-token')
  const grok = byName.get('saccesstoken')
  const platform =
    hint ||
    (cursor
      ? 'cursor'
      : claude
        ? 'anthropic'
        : gpt
          ? 'openai'
          : grok
            ? 'grok'
            : inferPlatform({ cookies: rows }, ''))
  if (!platform) return null
  const token = cursor || claude || gpt || grok || ''
  const customFields: Record<string, string> = { sessionCookies }
  if (cursor) customFields.sessionToken = cursor
  if (org) customFields.lastActiveOrg = org
  return emptyInput(platform, token, { customFields })
}

/** Parse Cockpit / Kiro / cookie-dump JSON. */
export function parseTokenJson(text: string, hint?: Platform): AccountInput | null {
  const raw = text.trim()
  if (!raw.startsWith('{') && !raw.startsWith('[')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (Array.isArray(parsed)) {
    const asCookies = fromCookiesArray(parsed, hint)
    if (asCookies) return asCookies
    parsed = parsed[0]
  }
  const root = asObj(parsed)
  if (!root) return null
  if (Array.isArray(root.cookies)) {
    const fromDump = fromCookiesArray(root.cookies, hint)
    if (fromDump) {
      const email = pick(root, ['email', 'userEmail'])
      if (email) {
        fromDump.email = email
        fromDump.username = email.split('@')[0]
        fromDump.label = pick(root, ['label', 'name']) || fromDump.label
      }
      return fromDump
    }
  }

  const cred = asObj(root.credentials) || asObj(root.token) || asObj(root.auth) || root
  const email =
    pick(cred, ['email', 'userEmail', 'username', 'user']) || pick(root, ['email', 'userEmail'])
  const refreshToken = pick(cred, [
    'refreshToken',
    'refresh_token',
    'WorkosCursorSessionToken',
    'sessionToken',
    'sessionKey',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'token',
    'authToken'
  ])
  if (!refreshToken && !email) return null

  const clientId = pick(cred, ['clientId', 'client_id']) || pick(root, ['clientId', 'client_id'])
  const clientSecret =
    pick(cred, ['clientSecret', 'client_secret']) || pick(root, ['clientSecret', 'client_secret'])
  const sessionToken = pick(cred, ['WorkosCursorSessionToken', 'sessionToken'])
  const sessionKey = pick(cred, ['sessionKey'])
  const lastActiveOrg = pick(cred, ['lastActiveOrg', 'orgId', 'organizationId']) || pick(root, ['lastActiveOrg'])
  const accessToken = pick(cred, ['accessToken', 'access_token'])
  const apiKey = pick(cred, ['apiKey', 'api_key'])
  const platform =
    hint ||
    inferPlatform({ ...root, ...cred }, email, refreshToken || sessionKey || apiKey) ||
    'cursor'
  const customFields: Record<string, string> = {}
  if (clientId) customFields.clientId = clientId
  if (clientSecret) customFields.clientSecret = clientSecret
  if (sessionToken) customFields.sessionToken = sessionToken
  if (sessionKey) customFields.sessionKey = sessionKey
  if (lastActiveOrg) customFields.lastActiveOrg = lastActiveOrg
  if (accessToken && accessToken !== refreshToken) customFields.accessToken = accessToken
  if (apiKey && apiKey !== refreshToken) customFields.apiKey = apiKey
  const project = pick(cred, ['project', 'projectId', 'cloudaicompanionProject']) || pick(root, ['project', 'projectId'])
  if (project) customFields.projectId = project
  if (platform === 'antigravity' && !customFields.provider) customFields.provider = 'google'
  const expires = pick(cred, ['expiresAt', 'expires_at', 'expiresIn'])
  if (expires) customFields.tokenExpires = expires

  const local = email.split('@')[0] || platform
  return {
    platform,
    label: pick(root, ['label', 'name', 'displayName']) || local,
    username: pick(cred, ['username', 'user']) || local,
    email,
    refreshToken: refreshToken || sessionKey || apiKey || null,
    mailboxClientId: clientId,
    customFields,
    notes: `从 ${platform} JSON / Token 导入`,
    status: 'active',
    tags: ['token-import']
  }
}

/** JSON, raw JWT, userId::jwt, Claude sessionKey, Windsurf API key. */
export function parseTokenText(text: string, hint?: Platform): AccountInput | null {
  const raw = text.trim()
  if (!raw) return null
  const json = parseTokenJson(raw, hint)
  if (json) return json

  if (/^sk-ant-sid0[12]-/i.test(raw)) {
    return emptyInput('anthropic', raw, { customFields: { sessionKey: raw } })
  }
  if (/^sk-ws-01-/i.test(raw)) {
    return emptyInput('windsurf', raw, { customFields: { apiKey: raw } })
  }
  if (/^xai-/i.test(raw)) {
    return emptyInput('grok', raw, { customFields: { apiKey: raw } })
  }
  if (hint === 'antigravity' && (/^1\/\//.test(raw) || raw.startsWith('ya29.'))) {
    return emptyInput('antigravity', raw, {
      customFields: raw.startsWith('ya29.') ? { accessToken: raw, provider: 'google' } : { provider: 'google' }
    })
  }
  if (/WorkosCursorSessionToken=|user_[A-Za-z0-9]+(%3A%3A|::)/i.test(raw)) {
    const cur = normalizeCursorSession(raw)
    if (cur) {
      return emptyInput('cursor', cur.cookieValue, { customFields: { sessionToken: cur.cookieValue } })
    }
  }
  if (raw.startsWith('eyJ') && raw.split('.').length >= 3) {
    const platform = hint || 'cursor'
    const cur = platform === 'cursor' ? normalizeCursorSession(raw) : null
    return emptyInput(platform, cur?.cookieValue || raw, {
      customFields: cur ? { sessionToken: cur.cookieValue } : {}
    })
  }
  if (hint && raw.length >= 24 && !/\s/.test(raw)) {
    return emptyInput(hint, raw)
  }
  return null
}

/** One or many accounts from a pasted blob or a .json file. */
export function parseTokenFile(text: string, hint?: Platform): AccountInput[] {
  const raw = text.trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0] as Record<string, unknown> | undefined
        const looksCookies = !!(first && first.name && first.value != null)
        if (looksCookies) {
          const one = parseTokenJson(raw, hint)
          return one ? [one] : []
        }
        return parsed
          .map((item) => parseTokenText(typeof item === 'string' ? item : JSON.stringify(item), hint))
          .filter((row): row is AccountInput => !!row)
      }
    } catch {
      /* fall through */
    }
  }
  const one = parseTokenText(raw, hint)
  return one ? [one] : []
}
