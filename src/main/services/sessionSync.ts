import type { Account, AccountInput, Platform } from '@shared/types'
import { normalizeCursorSession } from '@shared/tokenImport'
import {
  isProfileBusy,
  readProfileCookies,
  readProfileStorageState,
  writeProfileCookies
} from '../automation/browser'
import { getAccount, revealSecrets, updateAccount } from '../db/repositories/accounts'
import { enrichAccountIdentity, lookupCursorIdentity } from './identity'

type CookieIn = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None' | string
  expires?: number
}

function cookie(name: string, value: string, domain: string, extra?: Partial<CookieIn>): CookieIn {
  return {
    name,
    value,
    domain,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    ...extra
  }
}

function asCookies(raw: unknown): CookieIn[] {
  if (!Array.isArray(raw)) return []
  const out: CookieIn[] = []
  for (const c of raw) {
    const o = c as CookieIn
    if (!o?.name || o.value == null) continue
    out.push({
      name: String(o.name),
      value: String(o.value),
      domain: o.domain || '',
      path: o.path || '/',
      secure: o.secure !== false,
      httpOnly: !!o.httpOnly,
      sameSite: (o.sameSite as CookieIn['sameSite']) || 'Lax',
      expires: typeof o.expires === 'number' ? o.expires : undefined
    })
  }
  return out
}

function findCookie(cookies: CookieIn[], name: string, host?: string): string {
  const row = cookies.find(
    (c) =>
      c.name.toLowerCase() === name.toLowerCase() &&
      (!host || (c.domain || '').includes(host.replace(/^\./, '')))
  )
  return row?.value || ''
}

function parseStoredCookies(custom: Record<string, string>): CookieIn[] {
  const raw = custom.sessionCookies
  if (!raw) return []
  try {
    return asCookies(JSON.parse(raw))
  } catch {
    return []
  }
}

export function cookiesFromAccount(
  platform: Platform,
  token: string,
  custom: Record<string, string>
): CookieIn[] {
  const dumped = parseStoredCookies(custom)
  if (dumped.length) return dumped
  if (!token && !custom.sessionToken && !custom.sessionKey && !custom.apiKey) return []

  if (platform === 'cursor') {
    const cur = normalizeCursorSession(custom.sessionToken || token)
    if (!cur) return []
    return [cookie('WorkosCursorSessionToken', cur.cookieValue, '.cursor.com')]
  }
  if (platform === 'anthropic') {
    const key = custom.sessionKey || token
    if (!key.startsWith('sk-ant-')) return []
    const out = [cookie('sessionKey', key, '.claude.ai')]
    if (custom.lastActiveOrg) {
      out.push(cookie('lastActiveOrg', custom.lastActiveOrg, '.claude.ai', { httpOnly: false }))
    }
    return out
  }
  if (platform === 'openai') {
    if (!token || token.startsWith('{')) return []
    return [
      cookie('__Secure-next-auth.session-token', token, '.chatgpt.com'),
      cookie('__Secure-next-auth.session-token', token, '.openai.com')
    ]
  }
  if (platform === 'grok') {
    if (!token || token.startsWith('xai-') || token.startsWith('{')) return []
    return [
      cookie('sAccessToken', token, '.grok.com', { httpOnly: false }),
      cookie('sAccessToken', token, '.x.ai', { httpOnly: false })
    ]
  }
  return []
}

function scanStorageForToken(state: { origins?: { origin: string; localStorage: { name: string; value: string }[] }[] }): {
  refreshToken: string
  customFields: Record<string, string>
  email: string
} | null {
  for (const origin of state.origins || []) {
    for (const item of origin.localStorage || []) {
      const v = item.value?.trim()
      if (!v || (!v.startsWith('{') && !v.startsWith('['))) continue
      try {
        const obj = JSON.parse(v) as Record<string, unknown>
        const cred = (obj.credentials || obj.token || obj.auth || obj) as Record<string, unknown>
        const refreshToken = String(
          cred.refreshToken || cred.refresh_token || cred.accessToken || cred.apiKey || ''
        )
        if (!refreshToken) continue
        const customFields: Record<string, string> = {}
        if (cred.clientId || cred.client_id) customFields.clientId = String(cred.clientId || cred.client_id)
        if (cred.clientSecret || cred.client_secret)
          customFields.clientSecret = String(cred.clientSecret || cred.client_secret)
        if (cred.apiKey) customFields.apiKey = String(cred.apiKey)
        return {
          refreshToken,
          customFields,
          email: String(cred.email || cred.userEmail || obj.email || '')
        }
      } catch {
        /* next */
      }
    }
  }
  return null
}

/** Write pasted tokens into the isolated Chrome profile so official APIs see a session. */
export async function applySessionToProfile(accountId: string): Promise<number> {
  const acc = getAccount(accountId)
  if (!acc) return 0
  if (isProfileBusy(acc.profileDir)) return 0
  const secrets = revealSecrets(accountId)
  const token = secrets.refreshToken || acc.customFields.sessionToken || acc.customFields.sessionKey || ''
  const cookies = cookiesFromAccount(acc.platform, token, acc.customFields).filter(
    (c) => c.name && c.value && c.domain
  )
  if (!cookies.length) return 0
  return writeProfileCookies(acc.profileDir, cookies)
}

/** After official login, pull cookies / localStorage back into encrypted secrets. */
export async function captureSessionFromProfile(accountId: string): Promise<Account | null> {
  const acc = getAccount(accountId)
  if (!acc) return null
  if (isProfileBusy(acc.profileDir)) return acc
  let cookies: CookieIn[] = []
  try {
    cookies = asCookies(await readProfileCookies(acc.profileDir))
  } catch {
    return acc
  }
  const patch: Partial<AccountInput> = {}
  const custom = { ...acc.customFields }
  const secrets = revealSecrets(accountId)
  let changed = false

  if (acc.platform === 'cursor') {
    const raw = findCookie(cookies, 'WorkosCursorSessionToken', 'cursor.com')
    const cur = raw ? normalizeCursorSession(raw) : null
    if (cur && cur.cookieValue !== secrets.refreshToken) {
      patch.refreshToken = cur.cookieValue
      custom.sessionToken = cur.cookieValue
      changed = true
    }
    if (cur) {
      const id = await lookupCursorIdentity(cur.cookieValue)
      if (id.email && id.email !== acc.email) {
        patch.email = id.email
        if (!acc.label || acc.label === 'cursor' || /授权中$/.test(acc.label)) patch.label = id.email
        if (!acc.username || acc.username === 'cursor') patch.username = id.username || id.email.split('@')[0]
        changed = true
      }
      if (id.loginMethod && id.loginMethod !== acc.oauthProvider) patch.oauthProvider = id.loginMethod
    }
  } else if (acc.platform === 'anthropic') {
    const key = findCookie(cookies, 'sessionKey', 'claude.ai')
    const org = findCookie(cookies, 'lastActiveOrg', 'claude.ai')
    if (key && key !== secrets.refreshToken) {
      patch.refreshToken = key
      custom.sessionKey = key
      changed = true
    }
    if (org && org !== custom.lastActiveOrg) {
      custom.lastActiveOrg = org
      changed = true
    }
  } else if (acc.platform === 'openai') {
    const tok =
      findCookie(cookies, '__Secure-next-auth.session-token', 'chatgpt.com') ||
      findCookie(cookies, '__Secure-next-auth.session-token', 'openai.com')
    if (tok && tok !== secrets.refreshToken) {
      patch.refreshToken = tok
      changed = true
    }
  } else if (acc.platform === 'windsurf') {
    const tok =
      findCookie(cookies, 'session', 'windsurf.com') || findCookie(cookies, 'token', 'windsurf.com')
    if (tok && !secrets.refreshToken) {
      patch.refreshToken = tok
      changed = true
    }
  } else if (acc.platform === 'grok') {
    const tok =
      findCookie(cookies, 'sAccessToken', 'grok.com') ||
      findCookie(cookies, 'sAccessToken', 'x.ai') ||
      findCookie(cookies, 'sAccessToken', 'accounts.x.ai') ||
      findCookie(cookies, '__Secure-next-auth.session-token', 'grok.com')
    if (tok && tok !== secrets.refreshToken && !tok.startsWith('xai-')) {
      patch.refreshToken = tok
      changed = true
    }
  } else if (acc.platform === 'kiro' && !secrets.refreshToken) {
    try {
      const state = await readProfileStorageState(acc.profileDir)
      const found = scanStorageForToken(state as never)
      if (found) {
        patch.refreshToken = found.refreshToken
        Object.assign(custom, found.customFields)
        if (found.email && !acc.email) patch.email = found.email
        changed = true
      }
    } catch {
      /* ignore */
    }
  }

  if (cookies.length) {
    const slim = cookies
      .filter((c) => c.value)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure !== false,
        httpOnly: !!c.httpOnly,
        sameSite: c.sameSite || 'Lax'
      }))
    const next = JSON.stringify(slim)
    if (next !== custom.sessionCookies) {
      custom.sessionCookies = next
      changed = true
    }
  }

  if (changed) {
    patch.customFields = custom
    updateAccount(accountId, patch)
  }
  return (await enrichAccountIdentity(accountId)) || getAccount(accountId) || acc
}

export async function syncSessionAfterSave(accountId: string): Promise<void> {
  try {
    await applySessionToProfile(accountId)
  } catch {
    /* profile lock / chrome missing — token is still saved */
  }
}
