import type { Account, AccountInput, Platform } from '@shared/types'
import {
  isPlaceholderLabel,
  looksLikeEmail,
  normalizeLoginMethod,
  pickEmail,
  scanEmail
} from '@shared/identity'
import { jwtPayload, normalizeCursorSession } from '@shared/tokenImport'
import { getAccount, revealSecrets, updateAccount } from '../db/repositories/accounts'

export type IdentityHint = {
  email: string
  username: string
  loginMethod: string
}

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function identityFromJwt(raw: string): IdentityHint {
  const cur = normalizeCursorSession(raw)
  const jwt = cur?.jwt || (raw.startsWith('eyJ') ? raw : '')
  const p = jwt ? jwtPayload(jwt) : null
  if (!p) return { email: looksLikeEmail(raw) ? raw : '', username: '', loginMethod: '' }
  const scanned = Object.values(p).filter((v) => typeof v === 'string') as string[]
  const email = pickEmail(p.email, p.email_address, p.preferred_username, p.authId, p.sub, ...scanned)
  const method = normalizeLoginMethod(
    String(p.provider || p.amr || p.iss || p.signupType || p.connection || '')
  )
  return { email, username: String(p.name || p.preferred_username || email.split('@')[0] || ''), loginMethod: method }
}

async function fetchJson(url: string, headers: Record<string, string>, ms = 5000): Promise<Record<string, unknown>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal })
    if (!res.ok) return {}
    const data = (await res.json()) as unknown
    return asRec(data)
  } catch {
    return {}
  } finally {
    clearTimeout(timer)
  }
}

function cursorHeaders(sessionToken: string): Record<string, string> {
  const cur = normalizeCursorSession(sessionToken)
  const jwt = cur?.jwt || (sessionToken.startsWith('eyJ') ? sessionToken : '')
  const headers: Record<string, string> = {
    origin: 'https://cursor.com',
    referer: 'https://cursor.com/dashboard?tab=usage',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  }
  if (cur) {
    headers.cookie = `WorkosCursorSessionToken=${cur.headerValue}`
  }
  if (jwt) headers.authorization = `Bearer ${jwt}`
  return headers
}

async function probeCursorPages(headers: Record<string, string>, urls: string[]): Promise<Record<string, unknown>[]> {
  return Promise.all(urls.map((u) => fetchJson(u, headers)))
}

function mergeCursorHint(pages: Record<string, unknown>[], seed: IdentityHint): IdentityHint {
  let email = seed.email
  let username = seed.username
  let method = seed.loginMethod
  for (const page of pages) {
    if (!Object.keys(page).length) continue
    const user = asRec(page.user || page.account || page)
    email = email || pickEmail(user, page, page.email, user.email, page.authId) || scanEmail(page)
    username = username || String(user.name || user.displayName || page.name || '')
    method =
      method ||
      normalizeLoginMethod(String(user.authMethod || user.provider || page.signupType || page.authType || ''))
  }
  return {
    email,
    username: username || (email ? email.split('@')[0] : ''),
    loginMethod: method
  }
}

export async function lookupCursorIdentity(sessionToken: string): Promise<IdentityHint> {
  const fromJwt = identityFromJwt(sessionToken)
  const cookieOnly = cursorHeaders(sessionToken)
  delete cookieOnly.authorization
  const pages = await probeCursorPages(cookieOnly, [
    'https://cursor.com/api/auth/me',
    'https://cursor.com/api/auth/stripe',
    'https://cursor.com/api/usage-summary'
  ])
  return mergeCursorHint(pages, fromJwt)
}

export async function lookupGrokIdentity(token: string, cookies?: string): Promise<IdentityHint> {
  const headers: Record<string, string> = { origin: 'https://grok.com', referer: 'https://grok.com/' }
  if (cookies) headers.cookie = cookies
  if (token && !token.startsWith('xai-')) headers.authorization = `Bearer ${token}`
  const user = asRec(await fetchJson('https://grok.com/rest/user', headers))
  const session = asRec(await fetchJson('https://accounts.x.ai/api/auth/session', headers))
  const u = asRec(user.user || session.user || user)
  return {
    email: pickEmail(u, session, user),
    username: String(u.name || u.username || ''),
    loginMethod: normalizeLoginMethod(String(u.provider || session.provider || ''))
  }
}

function applyHint(acc: Account, hint: IdentityHint): Partial<AccountInput> {
  const patch: Partial<AccountInput> = {}
  const custom = { ...acc.customFields }
  if (hint.email && hint.email !== acc.email) {
    patch.email = hint.email
    if (isPlaceholderLabel(acc.label, acc.platform) || !acc.label.trim()) patch.label = hint.email
    if (!acc.username.trim() || isPlaceholderLabel(acc.username, acc.platform)) {
      patch.username = hint.username || hint.email.split('@')[0]
    }
  } else if (hint.username && (!acc.username.trim() || isPlaceholderLabel(acc.username, acc.platform))) {
    patch.username = hint.username
  }
  if (hint.loginMethod) {
    const method = normalizeLoginMethod(hint.loginMethod)
    if (method && method !== acc.oauthProvider) patch.oauthProvider = method
    if (method && custom.provider !== method) custom.provider = method
  }
  if (Object.keys(custom).some((k) => custom[k] !== acc.customFields[k])) patch.customFields = custom
  return patch
}

export function hintToAccountFields(hint: IdentityHint, extra?: Partial<AccountInput>): Partial<AccountInput> {
  const method = normalizeLoginMethod(hint.loginMethod)
  return {
    email: hint.email || extra?.email || '',
    username: hint.username || hint.email.split('@')[0] || extra?.username || '',
    label: hint.email || extra?.label || '',
    oauthProvider: method || extra?.oauthProvider,
    customFields: {
      ...(extra?.customFields || {}),
      ...(method ? { provider: method } : {})
    }
  }
}

export async function enrichAccountIdentity(accountId: string): Promise<Account | null> {
  const acc = getAccount(accountId)
  if (!acc) return null
  const secrets = revealSecrets(accountId)
  const token =
    acc.customFields.sessionToken ||
    acc.customFields.sessionKey ||
    acc.customFields.apiKey ||
    acc.customFields.accessToken ||
    secrets.refreshToken ||
    ''
  let hint: IdentityHint = { email: acc.email, username: acc.username, loginMethod: acc.oauthProvider }
  if (acc.platform === 'cursor' && token) {
    hint = await lookupCursorIdentity(acc.customFields.accessToken || token)
    if (!hint.email && acc.customFields.accessToken && acc.customFields.accessToken !== token) {
      const alt = await lookupCursorIdentity(token)
      if (alt.email) hint = alt
    }
  }
  else if (acc.platform === 'grok' && (token || acc.customFields.sessionCookies)) {
    hint = await lookupGrokIdentity(token)
  } else if (token) {
    hint = identityFromJwt(token)
    if (!hint.email) hint.email = acc.email
    if (!hint.loginMethod) hint.loginMethod = acc.oauthProvider || acc.customFields.provider || ''
  }
  if (acc.platform === 'antigravity' && !hint.loginMethod) hint.loginMethod = 'google'
  const patch = applyHint(acc, hint)
  if (!Object.keys(patch).length) return acc
  return updateAccount(accountId, patch)
}

export function enrichInputIdentity(platform: Platform, token: string, input: AccountInput): AccountInput {
  const hint = identityFromJwt(token)
  const fields = hintToAccountFields(hint, input)
  return {
    ...input,
    email: fields.email || input.email,
    username: fields.username || input.username,
    label: looksLikeEmail(fields.email || '') ? fields.email! : input.label,
    oauthProvider: fields.oauthProvider || input.oauthProvider,
    customFields: { ...input.customFields, ...fields.customFields }
  }
}
