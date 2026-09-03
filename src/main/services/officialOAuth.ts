import { createHash, randomBytes, randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AccountInput, OfficialOAuthStart, Platform } from '@shared/types'
import { jwtPayload } from '@shared/tokenImport'
import { hintToAccountFields, lookupCursorIdentity } from './identity'
import { AG_REDIRECT, AG_SCOPES, antigravityClient } from './antigravityOAuth'

type Session = {
  loginId: string
  platform: Platform
  authUrl: string
  expiresAt: number
  expiresIn: number
  intervalSeconds: number
  needsCallback: boolean
  verifier?: string
  uuid?: string
  state?: string
  redirectUri?: string
  server?: Server
  result?: AccountInput
  error?: string
  cancelled?: boolean
}

const sessions = new Map<string, Session>()

const OPENAI_CLIENT = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_REDIRECT = 'http://localhost:1455/auth/callback'
const WINDSURF_CLIENT = '3GUryQ7ldAeKEuD2obYnppsnmj58eP5u'
const KIRO_PORTS = [3128, 4649, 6588, 8008, 9091, 49153, 50153, 51153, 52153, 53153]

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function token(): string {
  return randomBytes(24).toString('base64url')
}

function page(ok: boolean, msg: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;background:#0d1117;color:#fff;text-align:center;padding:48px">
<h1 style="color:${ok ? '#4ade80' : '#f87171'}">${ok ? '授权成功' : '授权失败'}</h1>
<p>${msg}</p>
<script>setTimeout(function(){window.close()},1600)</script>
</body></html>`
}

function writeHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
}

function input(platform: Platform, refreshToken: string, extra?: Partial<AccountInput>): AccountInput {
  const email = extra?.email || ''
  const local = email.split('@')[0] || platform
  return {
    platform,
    label: extra?.label || local,
    username: extra?.username || local,
    email,
    refreshToken,
    mailboxClientId: extra?.mailboxClientId,
    customFields: extra?.customFields || {},
    notes: extra?.notes || `OAuth 授权导入（${platform}）`,
    status: 'active',
    tags: ['oauth']
  }
}

function finish(session: Session, result: AccountInput): AccountInput {
  session.result = result
  session.server?.close()
  session.server = undefined
  return result
}

function fail(session: Session, message: string): never {
  session.error = message
  session.server?.close()
  session.server = undefined
  throw new Error(message)
}

function listen(
  session: Session,
  host: string,
  port: number,
  onReq: (url: URL, res: ServerResponse) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          const raw = `http://${host}:${port}${req.url || '/'}`
          await onReq(new URL(raw), res)
        } catch (e) {
          writeHtml(res, 400, page(false, (e as Error).message))
        }
      })()
    })
    server.on('error', (err) => reject(err))
    server.listen(port, host, () => {
      session.server = server
      resolve()
    })
  })
}

async function bindFirst(session: Session, ports: number[], host = '127.0.0.1'): Promise<number> {
  for (const port of ports) {
    try {
      await new Promise<void>((resolve, reject) => {
        const probe = createServer()
        probe.once('error', reject)
        probe.listen(port, host, () => {
          probe.close(() => resolve())
        })
      })
      return port
    } catch {
      /* next */
    }
  }
  throw new Error('本地回调端口都被占用，请关掉占用进程后重试')
}

export async function startOfficialOAuth(platform: Platform): Promise<OfficialOAuthStart> {
  for (const s of sessions.values()) {
    if (s.platform === platform && !s.result && !s.error) {
      s.cancelled = true
      s.server?.close()
    }
  }

  const loginId = randomUUID()
  const now = Date.now()
  if (platform === 'cursor') {
    const { verifier, challenge } = pkce()
    const uuid = randomUUID()
    const authUrl = `https://cursor.com/loginDeepControl?challenge=${encodeURIComponent(challenge)}&uuid=${encodeURIComponent(uuid)}&mode=login`
    sessions.set(loginId, {
      loginId,
      platform,
      authUrl,
      expiresAt: now + 300_000,
      expiresIn: 300,
      intervalSeconds: 2,
      needsCallback: false,
      verifier,
      uuid
    })
    return { loginId, platform, authUrl, expiresIn: 300, intervalSeconds: 2, needsCallback: false }
  }

  if (platform === 'openai') {
    const { verifier, challenge } = pkce()
    const state = token()
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OPENAI_CLIENT,
      redirect_uri: OPENAI_REDIRECT,
      scope: 'openid profile email offline_access',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true'
    })
    const authUrl = `https://auth.openai.com/oauth/authorize?${params.toString()}`
    const session: Session = {
      loginId,
      platform,
      authUrl,
      expiresAt: now + 300_000,
      expiresIn: 300,
      intervalSeconds: 1,
      needsCallback: true,
      verifier,
      state,
      redirectUri: OPENAI_REDIRECT
    }
    sessions.set(loginId, session)
    try {
      await listen(session, '127.0.0.1', 1455, async (url, res) => {
        if (url.pathname !== '/auth/callback') {
          writeHtml(res, 404, page(false, 'Not Found'))
          return
        }
        try {
          await completeOpenAI(session, url)
          writeHtml(res, 200, page(true, '可以关闭此窗口返回应用'))
        } catch (e) {
          writeHtml(res, 400, page(false, (e as Error).message))
        }
      })
    } catch (e) {
      // Binding 1455 can fail with EADDRINUSE (Codex running) or EACCES (the
      // port sits in a Windows excluded/reserved range, common with Hyper-V /
      // WSL / Docker). OpenAI's client has 1455 as a fixed redirect_uri, so we
      // can't switch ports — but the manual-paste fallback still works, so we
      // must NOT fail oauth:start. Keep the auth URL and guide the user.
      const msg = String((e as Error).message || '')
      session.error = /EADDRINUSE/.test(msg)
        ? '本机 1455 端口被占用（可能是 Codex 正在运行）。可关掉后重试，或直接在浏览器完成授权，再把地址栏的回调地址粘到下方。'
        : /EACCES/.test(msg)
          ? '本机 1455 端口被系统保留（Hyper-V / WSL / Docker 常见）。请点「在浏览器中打开」完成授权，再把地址栏 http://localhost:1455/auth/callback?code=… 整段粘到下方「手动输入回调地址」。'
          : `本机回调服务启动失败（${msg}）。请在浏览器完成授权后，把回调地址粘到下方。`
    }
    return { loginId, platform, authUrl, expiresIn: 300, intervalSeconds: 1, needsCallback: true }
  }

  if (platform === 'kiro') {
    const { verifier, challenge } = pkce()
    const state = token()
    const session: Session = {
      loginId,
      platform,
      authUrl: '',
      expiresAt: now + 600_000,
      expiresIn: 600,
      intervalSeconds: 1,
      needsCallback: true,
      verifier,
      state
    }
    sessions.set(loginId, session)
    const port = await bindFirst(session, KIRO_PORTS)
    const redirectUri = `http://localhost:${port}`
    session.redirectUri = redirectUri
    session.authUrl =
      `https://app.kiro.dev/signin?state=${encodeURIComponent(state)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&code_challenge_method=S256` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&redirect_from=KiroIDE`
    void listen(session, '127.0.0.1', port, async (url, res) => {
      if (url.pathname !== '/oauth/callback' && url.pathname !== '/signin/callback') {
        writeHtml(res, 404, page(false, 'Not Found'))
        return
      }
      try {
        await completeKiro(session, url)
        writeHtml(res, 200, page(true, '可以关闭此窗口返回应用'))
      } catch (e) {
        writeHtml(res, 400, page(false, (e as Error).message))
      }
    })
    return {
      loginId,
      platform,
      authUrl: session.authUrl,
      expiresIn: 600,
      intervalSeconds: 1,
      needsCallback: true
    }
  }

  if (platform === 'windsurf') {
    const state = token()
    const session: Session = {
      loginId,
      platform,
      authUrl: '',
      expiresAt: now + 600_000,
      expiresIn: 600,
      intervalSeconds: 1,
      needsCallback: true,
      state
    }
    sessions.set(loginId, session)
    const port = await bindFirst(session, [18181, 18182, 18183, 28181, 38181])
    const redirectUri = `http://127.0.0.1:${port}/windsurf-auth-callback`
    session.redirectUri = redirectUri
    const q = new URLSearchParams({
      response_type: 'token',
      client_id: WINDSURF_CLIENT,
      redirect_uri: redirectUri,
      state,
      prompt: 'login',
      redirect_parameters_type: 'query',
      workflow: 'onboarding'
    })
    session.authUrl = `https://www.windsurf.com/windsurf/signin?${q.toString()}`
    void listen(session, '127.0.0.1', port, async (url, res) => {
      if (!url.pathname.startsWith('/windsurf-auth-callback')) {
        writeHtml(res, 404, page(false, 'Not Found'))
        return
      }
      try {
        completeWindsurf(session, url)
        writeHtml(res, 200, page(true, '可以关闭此窗口返回应用'))
      } catch (e) {
        writeHtml(res, 400, page(false, (e as Error).message))
      }
    })
    return { loginId, platform, authUrl: session.authUrl, expiresIn: 600, intervalSeconds: 1, needsCallback: true }
  }

  if (platform === 'antigravity') {
    const client = antigravityClient()
    const state = token()
    const session: Session = {
      loginId,
      platform,
      authUrl: '',
      expiresAt: now + 600_000,
      expiresIn: 600,
      intervalSeconds: 1,
      needsCallback: true,
      state,
      redirectUri: AG_REDIRECT
    }
    sessions.set(loginId, session)
    try {
      await listen(session, '127.0.0.1', 51121, async (url, res) => {
        if (url.pathname !== '/oauth-callback') {
          writeHtml(res, 404, page(false, 'Not Found'))
          return
        }
        try {
          await completeAntigravity(session, url)
          writeHtml(res, 200, page(true, '可以关闭此窗口返回应用'))
        } catch (e) {
          writeHtml(res, 400, page(false, (e as Error).message))
        }
      })
    } catch (e) {
      if (String((e as Error).message).includes('EADDRINUSE')) {
        session.error = '本机 51121 端口被占用。关掉占用进程后重试，或把回调地址贴进来。'
      } else {
        throw e
      }
    }
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: client.id,
      redirect_uri: AG_REDIRECT,
      scope: AG_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state
    })
    session.authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`
    return { loginId, platform, authUrl: session.authUrl, expiresIn: 600, intervalSeconds: 1, needsCallback: true }
  }

  throw new Error(`${platform} 没有公开 OAuth。请用 Token / JSON 粘贴`)
}

export function officialOAuthSnapshot(loginId: string): OfficialOAuthStart {
  const s = sessions.get(loginId)
  if (!s) throw new Error('没有进行中的授权会话')
  return {
    loginId: s.loginId,
    platform: s.platform,
    authUrl: s.authUrl,
    expiresIn: Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000)),
    intervalSeconds: s.intervalSeconds,
    needsCallback: s.needsCallback
  }
}

/** Resolves to null when the user closed the dialog — cancelling is not an error. */
export async function waitOfficialOAuth(loginId: string): Promise<AccountInput | null> {
  const session = sessions.get(loginId)
  if (!session) throw new Error('没有进行中的授权会话')
  if (session.platform === 'cursor') return pollCursor(session)
  while (Date.now() < session.expiresAt) {
    if (session.cancelled) return null
    if (session.error) throw new Error(session.error)
    if (session.result) return session.result
    await new Promise((r) => setTimeout(r, (session.intervalSeconds || 1) * 1000))
  }
  throw new Error('等待授权超时，请重试')
}

export async function submitOfficialOAuthCallback(loginId: string, raw: string): Promise<AccountInput> {
  const session = sessions.get(loginId)
  if (!session) throw new Error('没有进行中的授权会话')
  const url = parseCallback(raw, session.redirectUri || 'http://localhost/oauth/callback')
  if (session.platform === 'openai') return completeOpenAI(session, url)
  if (session.platform === 'kiro') return completeKiro(session, url)
  if (session.platform === 'windsurf') return completeWindsurf(session, url)
  if (session.platform === 'antigravity') return completeAntigravity(session, url)
  throw new Error('该平台不需要手动回调')
}

export function cancelOfficialOAuth(loginId?: string): void {
  for (const s of sessions.values()) {
    if (loginId && s.loginId !== loginId) continue
    s.cancelled = true
    s.server?.close()
    s.server = undefined
    if (!loginId || s.loginId === loginId) sessions.delete(s.loginId)
  }
}

function parseCallback(raw: string, fallbackBase: string): URL {
  const t = raw.trim()
  if (!t) throw new Error('回调地址不能为空')
  if (t.startsWith('http://') || t.startsWith('https://')) return new URL(t)
  if (t.startsWith('/')) return new URL(t, fallbackBase)
  // A bare authorization code (no `=`, no query) — wrap it as `?code=…`.
  const query = t.includes('=') ? t.replace(/^\?/, '') : `code=${encodeURIComponent(t)}`
  return new URL(`${fallbackBase}${fallbackBase.includes('?') ? '&' : '?'}${query}`)
}

async function pollCursor(session: Session): Promise<AccountInput | null> {
  const url = `https://api2.cursor.sh/auth/poll?uuid=${encodeURIComponent(session.uuid || '')}&verifier=${encodeURIComponent(session.verifier || '')}`
  while (Date.now() < session.expiresAt) {
    if (session.cancelled) return null
    let res: Response
    try {
      res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      })
    } catch {
      await new Promise((r) => setTimeout(r, session.intervalSeconds * 1000))
      continue
    }
    if (res.status === 404) {
      await new Promise((r) => setTimeout(r, session.intervalSeconds * 1000))
      continue
    }
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, session.intervalSeconds * 1000))
      continue
    }
    const data = (await res.json()) as {
      accessToken?: string
      refreshToken?: string
      authId?: string
    }
    const access = data.accessToken || ''
    const refresh = data.refreshToken || access
    if (!refresh) {
      await new Promise((r) => setTimeout(r, session.intervalSeconds * 1000))
      continue
    }
    const id = await lookupCursorIdentity(access || refresh)
    const email = id.email || (data.authId && data.authId.includes('@') ? data.authId : '')
    const fields = hintToAccountFields({ ...id, email }, { email, oauthProvider: id.loginMethod })
    return finish(
      session,
      input('cursor', refresh, {
        email,
        username: fields.username,
        label: email || fields.label,
        oauthProvider: fields.oauthProvider,
        customFields: {
          accessToken: access,
          sessionToken: refresh,
          authId: data.authId || '',
          provider: fields.oauthProvider || ''
        }
      })
    )
  }
  throw new Error('Cursor 登录轮询超时，请重试')
}

async function completeOpenAI(session: Session, url: URL): Promise<AccountInput> {
  if (session.state && url.searchParams.get('state') !== session.state) fail(session, 'OAuth state 校验失败')
  const err = url.searchParams.get('error')
  if (err) fail(session, `授权失败: ${err}`)
  const code = url.searchParams.get('code')
  if (!code) fail(session, '回调缺少 code')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: OPENAI_CLIENT,
    code,
    code_verifier: session.verifier || '',
    redirect_uri: session.redirectUri || OPENAI_REDIRECT
  })
  const res = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  const text = await res.text()
  if (!res.ok) fail(session, `OpenAI 换票失败 HTTP ${res.status}`)
  const data = JSON.parse(text) as {
    access_token?: string
    refresh_token?: string
    id_token?: string
  }
  const refresh = data.refresh_token || data.access_token || ''
  if (!refresh) fail(session, 'OpenAI 未返回 token')
  const claims = data.id_token ? jwtPayload(data.id_token) : null
  const email = String(claims?.email || claims?.preferred_username || '')
  return finish(
    session,
    input('openai', refresh, {
      email,
      customFields: {
        accessToken: data.access_token || '',
        idToken: data.id_token || ''
      }
    })
  )
}

async function completeKiro(session: Session, url: URL): Promise<AccountInput> {
  if (session.state && url.searchParams.get('state') && url.searchParams.get('state') !== session.state) {
    fail(session, '授权状态校验失败，请重新发起登录')
  }
  const err = url.searchParams.get('error')
  if (err) fail(session, `授权失败: ${err}`)
  const code = url.searchParams.get('code')
  if (!code) fail(session, 'Kiro 回调缺少 code')
  const loginOption = url.searchParams.get('login_option') || url.searchParams.get('loginOption') || ''
  const redirectUri = `${(session.redirectUri || '').replace(/\/$/, '')}${url.pathname}?login_option=${encodeURIComponent(loginOption)}`
  const res = await fetch('https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: session.verifier,
      redirect_uri: redirectUri
    })
  })
  const text = await res.text()
  if (!res.ok) fail(session, `Kiro 换票失败 HTTP ${res.status}`)
  const parsed = JSON.parse(text) as Record<string, unknown>
  const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed) as Record<string, unknown>
  const refresh = String(data.refreshToken || data.refresh_token || '')
  if (!refresh) fail(session, 'Kiro 未返回 refreshToken')
  // Social sign-in returns the email only inside the id_token claims.
  const idToken = String(data.idToken || data.id_token || data.idTokenJwt || data.id_token_jwt || '')
  let email = String(data.email || data.userEmail || '')
  if (!email && idToken) {
    const claims = jwtPayload(idToken)
    email = String(claims?.email || claims?.preferred_username || '')
  }
  return finish(
    session,
    input('kiro', refresh, {
      email,
      mailboxClientId: String(data.clientId || data.client_id || ''),
      customFields: {
        clientId: String(data.clientId || data.client_id || ''),
        clientSecret: String(data.clientSecret || data.client_secret || ''),
        accessToken: String(data.accessToken || data.access_token || ''),
        idToken,
        provider: String(data.provider || data.loginProvider || loginOption)
      }
    })
  )
}

async function completeAntigravity(session: Session, url: URL): Promise<AccountInput> {
  if (session.state && url.searchParams.get('state') !== session.state) fail(session, 'OAuth state 校验失败')
  const err = url.searchParams.get('error')
  if (err) fail(session, `授权失败: ${err}`)
  const code = url.searchParams.get('code')
  if (!code) fail(session, '回调缺少 code')
  const client = antigravityClient()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: client.id,
    client_secret: client.secret,
    code,
    redirect_uri: session.redirectUri || AG_REDIRECT
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  const text = await res.text()
  if (!res.ok) fail(session, `Antigravity 换票失败 HTTP ${res.status}`)
  const data = JSON.parse(text) as { access_token?: string; refresh_token?: string; id_token?: string }
  const refresh = data.refresh_token || ''
  const access = data.access_token || ''
  if (!refresh && !access) fail(session, 'Antigravity 未返回 token')
  let email = ''
  if (access) {
    try {
      const me = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { authorization: `Bearer ${access}` }
      })
      if (me.ok) {
        const info = (await me.json()) as { email?: string }
        email = info.email || ''
      }
    } catch {
      /* ignore */
    }
  }
  if (!email && data.id_token) {
    const claims = jwtPayload(data.id_token)
    email = String(claims?.email || '')
  }
  return finish(
    session,
    input('antigravity', refresh || access, {
      email,
      customFields: {
        accessToken: access,
        provider: 'google'
      }
    })
  )
}

function completeWindsurf(session: Session, url: URL): AccountInput {
  if (session.state && url.searchParams.get('state') !== session.state) fail(session, 'state 校验失败')
  const err = url.searchParams.get('error')
  if (err) fail(session, `授权失败: ${err}`)
  const access = url.searchParams.get('access_token') || url.searchParams.get('apiKey') || ''
  if (!access) fail(session, 'Windsurf 回调缺少 access_token')
  return finish(
    session,
    input('windsurf', access, {
      customFields: { apiKey: access, accessToken: access }
    })
  )
}
