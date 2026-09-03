import type { Account, AccountQuota, PlanKind, Platform, QuotaMeter } from '@shared/types'
import { inferPlanKind, meterWorthShowing, planDisplayName, planKindOf } from '@shared/membership'
import { hasQuota } from '@shared/platformFlags'
import { looksLikeEmail, scanEmail } from '@shared/identity'
import { jwtPayload, normalizeCursorSession } from '@shared/tokenImport'
import { isProfileBusy, readProfileCookies } from '../automation/browser'
import { getAccount, revealSecrets, updateAccount } from '../db/repositories/accounts'
import { applySessionToProfile, captureSessionFromProfile } from './sessionSync'
import { enrichAccountIdentity } from './identity'
import { AG_META, antigravityClient } from './antigravityOAuth'
import { recordQuotaSnapshot } from '../db/repositories/quotaHistory'
import { logger } from './logger'

type Cookie = { name: string; value: string; domain: string }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function cookieHeader(cookies: Cookie[], host: string): string {
  const key = host.replace(/^www\./, '')
  return cookies
    .filter((c) => (c.domain || '').includes(key))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Cursor reports money in cents. */
function dollars(cents: number | null): string {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`
}

function parsePctMessage(msg: unknown): number | null {
  const m = String(msg || '').match(/(\d+(?:\.\d+)?)\s*%/)
  return m ? Number(m[1]) : null
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function jitter(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

class HostGate {
  private tail = Promise.resolve()
  schedule<T>(fn: () => Promise<T>, gapMs: number): Promise<T> {
    const run = this.tail.then(async () => {
      try {
        return await fn()
      } finally {
        await sleep(gapMs + jitter(40, 160))
      }
    })
    this.tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }
}

const hostGates = new Map<string, HostGate>()

function gateFor(url: string): HostGate {
  let host = 'default'
  try {
    host = new URL(url).host
  } catch {
    /* keep default */
  }
  let g = hostGates.get(host)
  if (!g) {
    g = new HostGate()
    hostGates.set(host, g)
  }
  return g
}

function isAuthError(err: unknown): boolean {
  return /未登录|HTTP 401|HTTP 403|unauthorized|forbidden|invalid.?token|not authenticated/i.test(
    (err as Error).message || ''
  )
}

async function requestJsonRaw(
  url: string,
  headers: Record<string, string>,
  init?: { method?: string; body?: string }
): Promise<unknown> {
  let last = '请求失败'
  for (let i = 0; i < 3; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetch(url, {
        method: init?.method || 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': UA,
          ...headers
        },
        body: init?.body,
        signal: ctrl.signal
      })
      if (res.status === 429 || res.status === 503) {
        const ra = Number(res.headers.get('retry-after'))
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1200 * 2 ** i
        last = `HTTP ${res.status}`
        await sleep(wait + jitter(80, 240))
        continue
      }
      const text = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      try {
        return JSON.parse(text)
      } catch {
        throw new Error('接口返回的不是 JSON')
      }
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? '请求超时' : (e as Error).message
      last = msg
      if (i === 2 || /HTTP 40[13]/.test(msg)) throw new Error(last)
      await sleep(400 * 2 ** i + jitter(40, 120))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(last)
}

async function requestJson(
  url: string,
  headers: Record<string, string>,
  init?: { method?: string; body?: string }
): Promise<unknown> {
  return gateFor(url).schedule(() => requestJsonRaw(url, headers, init), 220)
}

async function firstJson(
  urls: string[],
  headers: Record<string, string>,
  init?: { method?: string; body?: string }
): Promise<unknown> {
  let last = '接口全部失败'
  for (const url of urls) {
    try {
      return await requestJson(url, headers, init)
    } catch (e) {
      last = (e as Error).message
    }
  }
  throw new Error(last)
}

function meter(
  id: QuotaMeter['id'],
  label: string,
  used: number | null,
  limit: number | null,
  unit: string,
  resetAt: number | null,
  extra?: {
    unlimited?: boolean
    note?: string
    hint?: string
    group?: string
    detail?: boolean
    info?: boolean
  }
): QuotaMeter {
  return {
    id,
    label,
    used,
    limit,
    unit,
    resetAt,
    unlimited: extra?.unlimited,
    note: extra?.note,
    hint: extra?.hint,
    group: extra?.group,
    detail: extra?.detail,
    info: extra?.info
  }
}

function ok(opts: {
  plan: string
  planKind?: PlanKind
  loginMethod?: string
  meters?: QuotaMeter[]
  used?: number | null
  limit?: number | null
  unit?: string
  resetAt?: number | null
  expiresAt?: number | null
  email?: string
  surface?: string
}): AccountQuota {
  const included = opts.meters?.find((m) => m.id === 'included')
  const used = included?.used ?? opts.used ?? null
  const limit = included?.unlimited ? null : (included?.limit ?? opts.limit ?? null)
  return {
    plan: opts.plan,
    planKind: opts.planKind || inferPlanKind(opts.plan),
    loginMethod: opts.loginMethod || '',
    used,
    limit,
    unit: included?.unit || opts.unit || '',
    resetAt: included?.resetAt ?? opts.resetAt ?? null,
    meters: opts.meters?.filter(meterWorthShowing),
    expiresAt: opts.expiresAt ?? null,
    email: opts.email || '',
    surface: opts.surface || '',
    error: '',
    fetchedAt: Date.now()
  }
}

async function readCookiesSafe(profileDir: string): Promise<Cookie[]> {
  if (isProfileBusy(profileDir)) return []
  try {
    return (await readProfileCookies(profileDir)) as Cookie[]
  } catch {
    return []
  }
}

// Cursor's first-party endpoints (verified against chotgpt/cursor-usage-viewer,
// which mirrors Cursor's own dashboard calls).
const CURSOR_OAUTH = 'https://api2.cursor.sh/oauth/token'
const CURSOR_CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB'
const CURSOR_USAGE = 'https://cursor.com/api/usage-summary'
const CURSOR_FULL_PROFILE = 'https://api2.cursor.sh/auth/full_stripe_profile'
const CURSOR_PROFILE = 'https://api2.cursor.sh/auth/stripe_profile'
const CURSOR_SAND_USAGE = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus'
// usage-summary is validated against this desktop UA; a generic one gets 401'd.
const CURSOR_USAGE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'

function cursorJwtExp(jwt: string): number | null {
  const p = jwtPayload(jwt)
  const exp = p ? Number(p.exp) : NaN
  return Number.isFinite(exp) ? exp : null
}

/** True when the access JWT is unparsable or expires within 5 minutes. */
function cursorTokenStale(access: string): boolean {
  const exp = cursorJwtExp(access)
  if (exp == null) return true
  return exp <= Math.floor(Date.now() / 1000) + 300
}

/** `WorkosCursorSessionToken=user_xxx::<jwt>` — the exact cookie Cursor expects. */
function cursorCookie(access: string): string | null {
  const sub = String(jwtPayload(access)?.sub || '')
  const user = sub.includes('|') ? sub.split('|').pop() || sub : sub
  if (!/^user_[A-Za-z0-9_-]+$/.test(user)) return null
  return `WorkosCursorSessionToken=${user}%3A%3A${access}`
}

async function cursorRefreshAccess(refresh: string): Promise<{ access: string; refresh: string }> {
  const res = await fetch(CURSOR_OAUTH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', client_id: CURSOR_CLIENT_ID, refresh_token: refresh }),
    signal: AbortSignal.timeout(20000)
  })
  const data = asRec(await res.json().catch(() => ({})))
  if (data.shouldLogout === true) throw new Error('Cursor 会话已注销，请重新官方授权登录')
  const access = String(data.access_token || data.accessToken || '')
  if (!access) throw new Error(`Cursor 令牌续期失败（HTTP ${res.status}）`)
  return { access, refresh: String(data.refresh_token || data.refreshToken || refresh) }
}

/** individualMembershipType wins unless the account is Enterprise. */
function cursorProfilePlan(profile: Record<string, unknown>): string {
  const membership = String(profile.membershipType || '').trim()
  const individual = String(profile.individualMembershipType || '').trim()
  if (individual && individual.toLowerCase() !== 'free' && membership.toLowerCase() !== 'enterprise') {
    return individual
  }
  return membership || individual
}

async function fetchCursorProfile(access: string): Promise<Record<string, unknown> | null> {
  for (const url of [CURSOR_FULL_PROFILE, CURSOR_PROFILE]) {
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${access}`, accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      })
      if (res.status === 401 || res.status === 403) continue
      if (!res.ok) continue
      const v = await res.json().catch(() => null)
      if (v && typeof v === 'object') return v as Record<string, unknown>
    } catch {
      /* try next */
    }
  }
  return null
}

/** Cursor's Grok Bot (internally "Sand") weekly usage — a separate fifth meter. */
async function fetchCursorSand(access: string): Promise<QuotaMeter | null> {
  try {
    const res = await fetch(CURSOR_SAND_USAGE, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'connect-protocol-version': '1'
      },
      body: '{}',
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return null
    const v = asRec(await res.json().catch(() => ({})))
    const pct = num(v.usagePercent)
    const hasLimit = v.hasNonZeroIncludedLimit === true || v.hasAvailableUsage === true
    if (pct == null && !hasLimit) return null
    const label = String(v.grokPlanLabel || 'Grok Bot')
    const resetAt = v.nextResetTimestampUtc ? Date.parse(String(v.nextResetTimestampUtc)) : null
    return meter('sand', label, pct, 100, '%', Number.isFinite(resetAt) ? resetAt : null, {
      hint: 'Cursor Grok Bot 周期用量（Sand）'
    })
  } catch {
    return null
  }
}

async function fetchCursor(accountId: string, cookies: Cookie[]): Promise<AccountQuota> {
  const acc = getAccount(accountId)
  if (!acc) throw new Error('账号不存在')
  const secrets = revealSecrets(accountId)
  const cf = acc.customFields

  // Access JWT: prefer the stored access token, else the JWT inside the session cookie.
  const cookieVal =
    cf.sessionToken || cookies.find((c) => c.name === 'WorkosCursorSessionToken')?.value || ''
  const norm = normalizeCursorSession(cf.accessToken || '') || normalizeCursorSession(cookieVal)
  let access = (cf.accessToken || '').startsWith('eyJ') ? cf.accessToken : norm?.jwt || ''
  // Refresh token is distinct from the cookie; ignore a `userId::jwt` masquerading as one.
  let refresh = secrets.refreshToken || cf.refreshToken || ''
  if (!refresh || refresh === access || refresh.includes('::')) refresh = ''

  // The access JWT is short-lived; refresh it before it 401s the usage call.
  if ((!access || cursorTokenStale(access)) && refresh) {
    try {
      const next = await cursorRefreshAccess(refresh)
      access = next.access
      const patch: Record<string, string> = { ...cf, accessToken: next.access }
      updateAccount(accountId, {
        customFields: patch,
        ...(next.refresh !== refresh ? { refreshToken: next.refresh } : {})
      })
    } catch (e) {
      if (!access) throw e
      /* keep trying the old access token */
    }
  }
  if (!access) {
    throw new Error('未登录 Cursor。请粘贴 WorkosCursorSessionToken / JWT，或点「官方授权」登录后再刷新')
  }

  const cookie = cursorCookie(access)
  if (!cookie) throw new Error('Cursor 会话令牌无法解析出用户 ID，请重新官方授权登录')

  let summary: Record<string, unknown>
  try {
    const res = await fetch(CURSOR_USAGE, {
      headers: { accept: 'application/json', cookie, 'user-agent': CURSOR_USAGE_UA },
      signal: AbortSignal.timeout(20000)
    })
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        refresh
          ? 'Cursor 拒绝了会话（HTTP 401）。请重新官方授权登录以更新令牌'
          : 'Cursor 会话已过期（HTTP 401）。该账号没有可续期的 refresh token，请重新官方授权登录'
      )
    }
    if (!res.ok) throw new Error(`Cursor 额度接口 HTTP ${res.status}`)
    summary = asRec(await res.json())
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Cursor 额度接口请求超时')
    throw e
  }

  const profile = await fetchCursorProfile(access)
  let rawPlan = String(summary.membershipType || (profile ? cursorProfilePlan(profile) : ''))
  let email = scanEmail(summary) || (profile ? scanEmail(profile) : '')
  const individual = asRec(summary.individualUsage)
  const planPool = asRec(individual.plan)
  const onDemand = asRec(individual.onDemand || individual.ondemand)
  const resetAt = summary.billingCycleEnd ? Date.parse(String(summary.billingCycleEnd)) : null
  const kind = planKindOf('cursor', rawPlan || 'hobby')
  const plan = planDisplayName('cursor', rawPlan || 'hobby', kind)
  const used = num(planPool.used)
  const limit = num(planPool.limit)
  const hasPool = used != null && limit != null && limit > 0
  const autoPct =
    num(planPool.autoPercentUsed) ?? parsePctMessage(summary.autoModelSelectedDisplayMessage)
  const apiPct =
    num(planPool.apiPercentUsed) ?? parsePctMessage(summary.namedModelSelectedDisplayMessage)
  const totalPct =
    num(planPool.totalPercentUsed) ??
    (hasPool ? Math.min(100, (used / limit) * 100) : autoPct)
  const unlimited = !!summary.isUnlimited
  const apiDollars = hasPool ? Math.round(limit / 100) : null
  const meters: QuotaMeter[] = []
  if (unlimited || totalPct != null || hasPool) {
    meters.push(
      meter('included', 'Total Usage', totalPct, unlimited ? null : 100, '%', resetAt, {
        unlimited,
        note: hasPool ? `${dollars(used)} / ${dollars(limit)}` : undefined,
        hint: hasPool ? '套餐内第三方模型额度' : '官方免费档，额度按请求次数限制'
      })
    )
  }
  if (autoPct != null) {
    meters.push(
      meter('weekly', 'Auto + Composer', autoPct, 100, '%', resetAt, {
        hint: kind === 'free' ? 'Hobby 含有限 Agent / Tab，用尽即停' : '超出后消耗 API 额度或按需计费'
      })
    )
  }
  if (apiPct != null && (hasPool || apiPct > 0)) {
    meters.push(
      meter('api', 'API Usage', apiPct, 100, '%', resetAt, {
        hint: apiDollars != null ? `超出后走按需。套餐至少含 $${apiDollars} API` : '超出后消耗按需用量'
      })
    )
  }
  const onEnabled = onDemand.enabled === true || onDemand.enabled === 'true'
  const onUsed = num(onDemand.used)
  const onLimit = num(onDemand.limit)
  // Cursor reports "no cap" as a sentinel near INT32_MAX; showing it as a
  // number would be nonsense, so treat anything that large as unlimited.
  const onUncapped = onLimit == null || onLimit >= 2_000_000_000
  if (!onEnabled) {
    meters.push(
      meter('ondemand', '按需使用', null, null, '', resetAt, {
        info: true,
        note: '已禁用',
        hint: '未开启按需计费，套餐额度用尽即停'
      })
    )
  } else {
    meters.push(
      meter('ondemand', '按需使用', onUsed, onUncapped ? null : onLimit, '¢', resetAt, {
        unlimited: onUncapped,
        note: onUsed != null ? (onUncapped ? dollars(onUsed) : `${dollars(onUsed)} / ${dollars(onLimit)}`) : undefined,
        hint: onUncapped ? '已开启按需且未设上限，按实际消耗计费' : '已开启按需，超出套餐后按此额度计费'
      })
    )
  }

  // Grok Bot (Sand) is an independent, optional fifth meter — never let it break core usage.
  const sand = await fetchCursorSand(access)
  if (sand) meters.push(sand)

  return ok({
    plan,
    planKind: kind,
    used: unlimited ? null : used,
    limit: unlimited || !hasPool ? null : limit,
    unit: hasPool ? '¢' : '',
    resetAt,
    meters,
    email
  })
}

async function fetchOpenAI(cookies: Cookie[], sessionToken: string): Promise<AccountQuota> {
  let header = cookieHeader(cookies, 'chatgpt.com') || cookieHeader(cookies, 'openai.com')
  if (!header && sessionToken) {
    header = `__Secure-next-auth.session-token=${sessionToken}`
  }
  if (!header) throw new Error('未登录 ChatGPT。请粘贴 Session Cookie，或点「官方授权」登录后再刷新额度')

  const data = asRec(
    await firstJson(
      [
        'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27',
        'https://chatgpt.com/backend-api/accounts/check',
        'https://chatgpt.com/backend-api/subscriptions'
      ],
      { cookie: header, origin: 'https://chatgpt.com', referer: 'https://chatgpt.com/' }
    )
  )
  const accounts = asRec(data.accounts || data)
  const def = asRec(accounts.default || Object.values(accounts)[0])
  const ent = asRec(def.entitlement || def.plan || data)
  const rawPlan = String(
    ent.subscription_plan ||
      ent.plan_type ||
      data.plan_type ||
      data.subscription_plan ||
      (ent.has_plus || data.has_plus ? 'Plus' : 'Free')
  )
  const kind = planKindOf('openai', rawPlan)
  const plan = planDisplayName('openai', rawPlan, kind)
  const expires = ent.expires_at || data.expires_at ? Date.parse(String(ent.expires_at || data.expires_at)) : null
  const used = num(ent.used ?? def.used ?? data.used)
  const limit = num(ent.limit ?? def.limit ?? data.limit)
  const extraUsed = num(ent.on_demand_used ?? ent.premium_used ?? def.on_demand_used)
  const extraLimit = num(ent.on_demand_limit ?? ent.premium_limit ?? def.on_demand_limit)
  const meters: QuotaMeter[] = [meter('included', '套餐额度', used, limit, '', expires)]
  if (extraUsed != null || extraLimit != null) {
    meters.push(meter('premium', '额外额度', extraUsed, extraLimit, '', expires))
  }
  return ok({
    plan,
    planKind: kind,
    used,
    limit,
    unit: '',
    resetAt: expires,
    expiresAt: expires,
    meters
  })
}

async function fetchAnthropic(cookies: Cookie[], sessionKey: string, orgId: string): Promise<AccountQuota> {
  const key =
    sessionKey ||
    cookies.find((c) => c.name === 'sessionKey')?.value ||
    ''
  if (!key.startsWith('sk-ant-')) {
    throw new Error('未登录 Claude。请粘贴 sessionKey（sk-ant-sid…），或点「官方授权」登录后再刷新')
  }
  const orgCookie = orgId || cookies.find((c) => c.name === 'lastActiveOrg')?.value || ''
  const cookie = [
    `sessionKey=${key}`,
    orgCookie ? `lastActiveOrg=${orgCookie}` : '',
    cookieHeader(cookies, 'claude.ai')
  ]
    .filter(Boolean)
    .join('; ')
  const headers = {
    cookie,
    origin: 'https://claude.ai',
    referer: 'https://claude.ai/'
  }
  let org = orgCookie
  if (!org) {
    const orgs = await requestJson('https://claude.ai/api/organizations', headers)
    const list = Array.isArray(orgs) ? orgs : ((asRec(orgs).organizations || asRec(orgs).data) as unknown[])
    const first = asRec(Array.isArray(list) ? list[0] : list)
    org = String(first.uuid || first.id || first.organization_uuid || '')
  }
  if (!org) throw new Error('Claude 已登录，但读不到组织 ID。把 lastActiveOrg 一并粘贴进 JSON')

  const usage = asRec(await requestJson(`https://claude.ai/api/organizations/${org}/usage`, headers))
  const five = asRec(usage.five_hour)
  const week = asRec(usage.seven_day)
  const extra = asRec(usage.seven_day_sonnet || usage.extra || usage.overage)
  const fiveUsed = num(five.utilization)
  const weekUsed = num(week.utilization)
  const extraUsed = num(extra.utilization ?? extra.used)
  const extraLimit = num(extra.limit)
  const fiveReset = five.resets_at ? Date.parse(String(five.resets_at)) : null
  const weekReset = week.resets_at ? Date.parse(String(week.resets_at)) : null
  const orgRec = asRec(
    await requestJson(`https://claude.ai/api/organizations/${org}`, headers).catch(() => ({}))
  )
  const rawPlan = String(
    asRec(orgRec.settings).claude_ai_plan ||
      orgRec.rate_limit_tier ||
      orgRec.subscription_type ||
      'Claude'
  )
  const kind = planKindOf('anthropic', rawPlan)
  const plan = planDisplayName('anthropic', rawPlan, kind)
  const meters: QuotaMeter[] = [
    meter('included', '5 小时额度', fiveUsed, fiveUsed != null ? 100 : null, '%', fiveReset, {
      hint: '短窗口用量，用完后等重置'
    })
  ]
  if (weekUsed != null) {
    meters.push(meter('weekly', '7 日额度', weekUsed, 100, '%', weekReset))
  }
  if (extraUsed != null || extraLimit != null) {
    meters.push(meter('premium', '额外额度', extraUsed, extraLimit ?? 100, extraLimit != null ? '' : '%', weekReset))
  }
  return ok({
    plan,
    planKind: kind,
    used: fiveUsed,
    limit: fiveUsed != null ? 100 : null,
    unit: '%',
    resetAt: fiveReset,
    meters
  })
}

async function fetchWindsurf(cookies: Cookie[], apiKey: string): Promise<AccountQuota> {
  const key = apiKey.startsWith('sk-ws-') ? apiKey : ''
  if (key) {
    const body = JSON.stringify({
      metadata: {
        apiKey: key,
        ideName: 'windsurf',
        ideVersion: '0.0.0',
        extensionName: 'windsurf',
        extensionVersion: '0.0.0',
        locale: 'en'
      }
    })
    const data = asRec(
      await requestJson(
        'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus',
        {
          'content-type': 'application/json',
          'connect-protocol-version': '1'
        },
        { method: 'POST', body }
      )
    )
    const planStatus = asRec(asRec(asRec(data.userStatus).planStatus))
    const info = asRec(planStatus.planInfo)
    const usedRaw = num(planStatus.usedPromptCredits)
    const avail = num(planStatus.availablePromptCredits)
    const used = usedRaw != null ? usedRaw / 100 : null
    const limit = avail != null && avail >= 0 ? avail / 100 : null
    const resetAt = planStatus.planEnd ? Date.parse(String(planStatus.planEnd)) : null
    const extraUsed = num(planStatus.usedFlexCredits ?? planStatus.usedPremiumCredits)
    const extraAvail = num(planStatus.availableFlexCredits ?? planStatus.availablePremiumCredits)
    const meters: QuotaMeter[] = [meter('included', 'Prompt credits', used, limit, 'credit', resetAt)]
    if (extraUsed != null || extraAvail != null) {
      meters.push(
        meter(
          'premium',
          'Flex / Premium',
          extraUsed != null ? extraUsed / 100 : null,
          extraAvail != null ? extraAvail / 100 : null,
          'credit',
          resetAt
        )
      )
    }
    const rawPlan = String(info.planName || 'Windsurf')
    return ok({
      plan: planDisplayName('windsurf', rawPlan),
      planKind: planKindOf('windsurf', rawPlan),
      used,
      limit,
      unit: 'credit',
      resetAt,
      meters
    })
  }

  const header = cookieHeader(cookies, 'windsurf.com') || cookieHeader(cookies, 'codeium.com')
  if (!header) {
    throw new Error('没有 Windsurf API Key。请粘贴 sk-ws-01-…，或点「官方授权」登录后再刷新')
  }
  const session = asRec(
    await requestJson('https://windsurf.com/api/auth/session', {
      cookie: header,
      origin: 'https://windsurf.com',
      referer: 'https://windsurf.com/'
    })
  )
  const user = asRec(session.user)
  return ok({ plan: String(user.plan || session.plan || 'Windsurf · 已登录') })
}

function parseKiroUsage(usage: Record<string, unknown>): AccountQuota {
  const list = (Array.isArray(usage.usageBreakdownList) ? usage.usageBreakdownList : []) as Record<
    string,
    unknown
  >[]
  const credit = asRec(list.find((b) => String(b.resourceType) === 'CREDIT') || list[0])
  const used = num(credit.currentUsageWithPrecision ?? credit.currentUsage) ?? 0
  const limit = num(credit.usageLimitWithPrecision ?? credit.usageLimit) ?? 0
  const sub = asRec(usage.subscriptionInfo)
  const plan = String(sub.subscriptionTitle || sub.type || usage.subscriptionType || 'Kiro')
  let resetAt: number | null = null
  if (usage.nextDateReset != null) {
    const n = Number(usage.nextDateReset)
    if (Number.isFinite(n) && n > 1e12) resetAt = n
    else if (Number.isFinite(n) && n > 1e9) resetAt = n * 1000
    else resetAt = Date.parse(String(usage.nextDateReset))
    if (!Number.isFinite(resetAt)) resetAt = null
  }

  const meters: QuotaMeter[] = [
    meter('included', 'User Prompt credits', used, limit || null, 'credit', resetAt)
  ]
  const ft = asRec(credit.freeTrialInfo)
  if (String(ft.freeTrialStatus || ft.status) === 'ACTIVE') {
    meters.push(
      meter(
        'premium',
        '试用额度',
        num(ft.currentUsageWithPrecision ?? ft.currentUsage),
        num(ft.usageLimitWithPrecision ?? ft.usageLimit),
        'credit',
        resetAt
      )
    )
  }
  const bonuses = (Array.isArray(credit.bonuses) ? credit.bonuses : []) as Record<string, unknown>[]
  let bonusUsed = 0
  let bonusLimit = 0
  let hasBonus = false
  for (const b of bonuses) {
    if (String(b.status) !== 'ACTIVE') continue
    hasBonus = true
    bonusUsed += num(b.currentUsageWithPrecision ?? b.currentUsage ?? b.current) ?? 0
    bonusLimit += num(b.usageLimitWithPrecision ?? b.usageLimit ?? b.limit) ?? 0
  }
  if (hasBonus) {
    meters.push(meter('ondemand', '奖励额度', bonusUsed, bonusLimit || null, 'credit', resetAt))
  }

  return ok({
    plan: planDisplayName('kiro', plan),
    planKind: planKindOf('kiro', plan),
    used,
    limit: limit || null,
    unit: 'credit',
    resetAt,
    meters
  })
}

const KIRO_UA = 'KiroIDE/0.12.155'
const KIRO_SOCIAL_REFRESH = 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken'
const KIRO_OIDC_REFRESH = 'https://oidc.us-east-1.amazonaws.com/token'

/** Kiro social sign-in (Google / GitHub): POST {refreshToken} to the desktop auth service. */
async function kiroRefreshSocial(refreshToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(KIRO_SOCIAL_REFRESH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      'user-agent': KIRO_UA
    },
    body: JSON.stringify({ refreshToken }),
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`Kiro（社交登录）令牌刷新失败 HTTP ${res.status}`)
  return asRec(await res.json().catch(() => ({})))
}

/** Kiro AWS Builder ID (IAM Identity Center) needs the device clientId + clientSecret. */
async function kiroRefreshOidc(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<Record<string, unknown>> {
  const body: Record<string, string> = { grantType: 'refresh_token', refreshToken }
  if (clientId) body.clientId = clientId
  if (clientSecret) body.clientSecret = clientSecret
  const res = await fetch(KIRO_OIDC_REFRESH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': KIRO_UA, 'x-amz-user-agent': KIRO_UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`Kiro（Builder ID）令牌刷新失败 HTTP ${res.status}`)
  return asRec(await res.json().catch(() => ({})))
}

async function fetchKiro(accountId: string): Promise<AccountQuota> {
  const acc = getAccount(accountId)
  if (!acc) throw new Error('账号不存在')
  const secrets = revealSecrets(accountId)
  const refreshToken = secrets.refreshToken
  if (!refreshToken) throw new Error('没有 Kiro Token。请粘贴 JSON / refreshToken，或点「官方授权」登录后再刷新')
  const clientId = acc.customFields.clientId || acc.mailboxClientId
  const clientSecret = acc.customFields.clientSecret
  const provider = (acc.customFields.provider || acc.oauthProvider || '').toLowerCase()
  // Builder ID accounts carry a device clientId+clientSecret; social (Google /
  // GitHub) accounts don't and must use the Kiro desktop refresh endpoint. Pick
  // the right one, then fall back to the other so either import style recovers.
  const preferBuilderId = !!clientSecret || provider.includes('builder') || provider.includes('aws')
  const refreshers = preferBuilderId
    ? [
        () => kiroRefreshOidc(refreshToken, clientId, clientSecret),
        () => kiroRefreshSocial(refreshToken)
      ]
    : [
        () => kiroRefreshSocial(refreshToken),
        () => kiroRefreshOidc(refreshToken, clientId, clientSecret)
      ]
  let data: Record<string, unknown> = {}
  let lastErr = 'Kiro Token 刷新失败'
  for (const attempt of refreshers) {
    try {
      data = await attempt()
      if (data.accessToken || data.access_token) break
    } catch (e) {
      lastErr = (e as Error).message
    }
  }
  const access = String(data.accessToken || data.access_token || '')
  if (!access) throw new Error(lastErr)
  const nextRefresh = String(data.refreshToken || data.refresh_token || '')
  if (nextRefresh && nextRefresh !== refreshToken) {
    updateAccount(accountId, { refreshToken: nextRefresh })
  }

  const auth = {
    authorization: `Bearer ${access}`,
    'x-amz-user-agent': 'KiroIDE/0.12.155'
  }
  try {
    const usage = asRec(
      await firstJson(
        [
          'https://q.us-east-1.amazonaws.com/getUsageLimits',
          'https://q.eu-central-1.amazonaws.com/getUsageLimits'
        ],
        auth
      )
    )
    return parseKiroUsage(usage)
  } catch {
    const exp = num(data.expiresIn)
    return ok({ plan: 'Kiro · Token 有效', expiresAt: exp ? Date.now() + exp * 1000 : null })
  }
}

function pickUsage(rec: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = num(rec[k])
    if (n != null) return n
  }
  return null
}

async function fetchGrok(cookies: Cookie[], apiKey: string): Promise<AccountQuota> {
  if (apiKey.startsWith('xai-')) {
    const data = asRec(
      await requestJson('https://api.x.ai/v1/api-key', {
        authorization: `Bearer ${apiKey}`
      })
    )
    const name = String(data.name || data.team || data.user || 'xAI API')
    const kind = planKindOf('grok', name)
    return ok({
      plan: name.includes('API') ? name : `${name} · API`,
      planKind: kind === 'unknown' ? 'pro' : kind,
      loginMethod: 'token'
    })
  }

  const cookie =
    cookieHeader(cookies, 'grok.com') ||
    cookieHeader(cookies, 'x.ai') ||
    cookieHeader(cookies, 'accounts.x.ai')
  const bearer = apiKey && !apiKey.startsWith('xai-') ? apiKey : ''
  if (!cookie && !bearer) throw new Error('未登录 Grok。请粘贴 xai- API Key，或点「官方授权」登录后再刷新')

  const headers: Record<string, string> = {
    origin: 'https://grok.com',
    referer: 'https://grok.com/'
  }
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`

  const limits = asRec(await requestJson('https://grok.com/rest/rate-limits', headers).catch(() => ({})))
  const user = asRec(await requestJson('https://grok.com/rest/user', headers).catch(() => ({})))
  const session = asRec(
    await requestJson('https://accounts.x.ai/api/auth/session', headers).catch(() => ({}))
  )
  const u = asRec(user.user || session.user || user)
  const sub = asRec(u.subscription || user.subscription || limits.subscription || session.subscription)
  const usage = asRec(limits.usage || user.usage || limits)
  const named = String(
    sub.name || sub.tier || sub.plan || u.subscription || limits.product || session.product || ''
  )
  const premium = !!(sub.active || sub.premium || u.premium || /super|plus|pro/i.test(named))
  const plan = named || (premium ? 'SuperGrok' : Object.keys(u).length || Object.keys(limits).length ? 'Grok' : '')
  if (!plan) throw new Error('Grok 会话无效。请重新官方授权或粘贴 Cookie JSON')
  const used =
    pickUsage(usage, ['used', 'usedQueries', 'queriesUsed']) ?? pickUsage(limits, ['used', 'usedQueries'])
  const remaining = pickUsage(usage, ['remainingQueries', 'remaining', 'queriesRemaining'])
  const limit =
    pickUsage(usage, ['limit', 'queryLimit', 'queriesLimit', 'maxQueries']) ??
    pickUsage(limits, ['limit', 'queryLimit']) ??
    (used != null && remaining != null ? used + remaining : remaining)
  const extraUsed = pickUsage(usage, ['extraUsed', 'extraUsageUsed'])
  const extraLimit = pickUsage(usage, ['extraLimit', 'extraUsageLimit'])
  const resetRaw = usage.resetAt || usage.resetTime || limits.resetAt || limits.resetTime || sub.resetAt
  const resetAt = resetRaw ? Date.parse(String(resetRaw)) : null
  const meters: QuotaMeter[] = []
  if (used != null || limit != null) meters.push(meter('included', '查询额度', used, limit, '', resetAt))
  if (extraUsed != null || extraLimit != null) {
    meters.push(meter('premium', '额外额度', extraUsed, extraLimit, '', resetAt))
  }
  return ok({
    plan: planDisplayName('grok', plan),
    planKind: planKindOf('grok', plan),
    used,
    limit,
    resetAt,
    meters: meters.length ? meters : undefined,
    loginMethod: String(u.provider || session.provider || user.provider || '')
  })
}

async function refreshGoogleAccess(refreshToken: string): Promise<{ access: string; refresh: string }> {
  const client = antigravityClient()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.id,
    client_secret: client.secret
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Antigravity 刷新令牌失败 HTTP ${res.status}`)
  const data = JSON.parse(text) as { access_token?: string; refresh_token?: string }
  if (!data.access_token) throw new Error('Antigravity 未返回 access_token')
  return { access: data.access_token, refresh: data.refresh_token || refreshToken }
}

function agWindow(resetAt: number | null, label: string): '5h' | 'week' {
  if (/5\s*h|five.?hour/i.test(label)) return '5h'
  if (/week|7\s*d|weekly/i.test(label)) return 'week'
  if (resetAt && resetAt - Date.now() <= 8 * 3600_000) return '5h'
  return 'week'
}

function agFamily(id: string, provider: string): 'claude' | 'gemini' | 'other' {
  const s = `${id} ${provider}`.toLowerCase()
  if (s.includes('claude') || s.includes('anthropic') || s.includes('sonnet') || s.includes('opus')) return 'claude'
  if (s.includes('gemini') || s.includes('google') || s.includes('flash')) return 'gemini'
  return 'other'
}

/** `models/gemini-3-pro-preview` → `Gemini 3 Pro`. */
function agModelLabel(id: string, display: string): string {
  if (display) return display
  return id
    .replace(/^models\//, '')
    .replace(/-(preview|latest|exp|experimental)(-\d+)?$/i, '')
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

async function fetchAntigravity(accountId: string): Promise<AccountQuota> {
  const acc = getAccount(accountId)
  if (!acc) throw new Error('账号不存在')
  const secrets = revealSecrets(accountId)
  const refresh = secrets.refreshToken || acc.customFields.refreshToken || ''
  let access = acc.customFields.accessToken || ''
  if (!refresh && !access) throw new Error('未登录 Antigravity。请点「官方授权」或粘贴 Google refresh_token / oauth JSON')
  if (refresh) {
    const next = await refreshGoogleAccess(refresh)
    access = next.access
    const patch = { ...acc.customFields, accessToken: next.access }
    if (next.refresh !== refresh) {
      updateAccount(accountId, { refreshToken: next.refresh, customFields: patch })
    } else {
      updateAccount(accountId, { customFields: patch })
    }
  }

  const headers = {
    authorization: `Bearer ${access}`,
    'content-type': 'application/json',
    'user-agent': 'antigravity/1.15.8 windows/amd64',
    'x-goog-api-client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'client-metadata': JSON.stringify(AG_META)
  }
  const loaded = asRec(
    await requestJson('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', headers, {
      method: 'POST',
      body: JSON.stringify({ metadata: AG_META })
    })
  )
  const tier = asRec(loaded.currentTier || loaded.paidTier || loaded.planInfo)
  const rawPlan = String(tier.name || tier.id || asRec(loaded.planInfo).planType || 'Antigravity')
  const credits = num(loaded.availablePromptCredits ?? asRec(loaded.planInfo).monthlyPromptCredits)
  const creditLimit = num(asRec(loaded.planInfo).monthlyPromptCredits)
  let project = String(loaded.cloudaicompanionProject || acc.customFields.projectId || '')
  if (project && !project.startsWith('projects/')) project = `projects/${project}`
  if (project) {
    const latest = getAccount(accountId)
    if (latest) updateAccount(accountId, { customFields: { ...latest.customFields, projectId: project, accessToken: access } })
  }

  const modelsRaw = project
    ? asRec(
        await requestJson('https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', headers, {
          method: 'POST',
          body: JSON.stringify({ project })
        }).catch(() => ({}))
      )
    : {}
  const models = asRec(modelsRaw.models)
  const buckets = new Map<string, { used: number; resetAt: number | null }>()
  const perModel: QuotaMeter[] = []
  for (const [id, raw] of Object.entries(models)) {
    const row = asRec(raw)
    const q = asRec(row.quotaInfo)
    const remaining = num(q.remainingFraction)
    if (remaining == null) continue
    const family = agFamily(id, String(row.modelProvider || row.provider || ''))
    const used = Math.min(100, Math.max(0, (1 - remaining) * 100))
    const resetAt = q.resetTime ? Date.parse(String(q.resetTime)) : null
    const window = agWindow(resetAt, String(row.windowLabel || row.label || ''))
    if (family !== 'other') {
      const key = `${family}_${window}`
      const prev = buckets.get(key)
      if (!prev || used > prev.used) buckets.set(key, { used, resetAt })
    }
    perModel.push(
      meter(
        `model:${id}:${window}`,
        `${agModelLabel(id, String(row.displayName || row.title || ''))} · ${window === '5h' ? '5h' : 'Weekly'}`,
        used,
        100,
        '%',
        resetAt,
        { group: family, detail: true }
      )
    )
  }
  perModel.sort((a, b) => a.label.localeCompare(b.label))

  const meters: QuotaMeter[] = []
  const add = (id: string, group: string, label: string): void => {
    const b = buckets.get(id)
    if (b) meters.push(meter(id, label, b.used, 100, '%', b.resetAt, { group }))
  }
  add('claude_5h', 'claude', '5h')
  add('claude_week', 'claude', 'Weekly')
  add('gemini_5h', 'gemini', '5h')
  add('gemini_week', 'gemini', 'Weekly')
  if (credits != null || creditLimit != null) {
    meters.push(
      meter(
        'credits',
        '可用 AI 积分',
        credits != null && creditLimit != null ? Math.max(0, creditLimit - credits) : credits,
        creditLimit,
        '',
        null,
        { hint: credits != null ? `剩余 ${credits}` : undefined }
      )
    )
  }
  meters.push(...perModel)

  const surface = String(loaded.ideType || AG_META.ideType) === 'ANTIGRAVITY' ? 'Antigravity IDE' : 'Antigravity'
  return ok({
    plan: planDisplayName('antigravity', rawPlan),
    planKind: planKindOf('antigravity', rawPlan),
    used: credits,
    limit: creditLimit,
    resetAt: [...buckets.values()].map((b) => b.resetAt).find((t) => t != null) ?? null,
    meters,
    loginMethod: 'google',
    surface
  })
}

export function supportsQuota(platform: Platform): boolean {
  return hasQuota(platform)
}

async function fetchQuotaFor(accountId: string): Promise<AccountQuota> {
  const latest = getAccount(accountId)
  if (!latest) throw new Error('账号不存在')
  const secrets = revealSecrets(accountId)
  const session =
    latest.customFields.sessionToken ||
    latest.customFields.sessionKey ||
    latest.customFields.apiKey ||
    secrets.refreshToken ||
    ''
  if (latest.platform === 'kiro') return fetchKiro(accountId)
  if (latest.platform === 'antigravity') return fetchAntigravity(accountId)
  let cookies: Cookie[] = []
  if (latest.customFields.sessionCookies) {
    try {
      const rows = JSON.parse(latest.customFields.sessionCookies) as Cookie[]
      if (Array.isArray(rows)) cookies = rows.filter((c) => c?.name && c.value)
    } catch {
      /* ignore */
    }
  }
  if (!cookies.length && !session) cookies = await readCookiesSafe(latest.profileDir)
  if (latest.platform === 'cursor') return fetchCursor(accountId, cookies)
  if (latest.platform === 'openai') return fetchOpenAI(cookies, session)
  if (latest.platform === 'anthropic') {
    return fetchAnthropic(cookies, session, latest.customFields.lastActiveOrg || '')
  }
  if (latest.platform === 'windsurf') return fetchWindsurf(cookies, session)
  if (latest.platform === 'grok') return fetchGrok(cookies, session)
  throw new Error(`${latest.platform} 额度接口尚未对接`)
}

function failedQuota(latest: Account, message: string): AccountQuota {
  return {
    plan: latest.quota?.plan || '',
    planKind: latest.quota?.planKind,
    loginMethod: latest.quota?.loginMethod,
    used: latest.quota?.used ?? null,
    limit: latest.quota?.limit ?? null,
    unit: latest.quota?.unit || '',
    resetAt: latest.quota?.resetAt ?? null,
    meters: latest.quota?.meters,
    expiresAt: latest.quota?.expiresAt ?? null,
    surface: latest.quota?.surface,
    error: message,
    fetchedAt: Date.now()
  }
}

async function syncSessionIfIdle(accountId: string): Promise<void> {
  const acc = getAccount(accountId)
  if (!acc || isProfileBusy(acc.profileDir)) return
  await captureSessionFromProfile(accountId).catch(() => null)
  await applySessionToProfile(accountId).catch(() => undefined)
}

const inflightQuota = new Map<string, Promise<Account>>()

export async function refreshAccountQuota(
  accountId: string,
  opts?: { sync?: 'auto' | 'force' | 'never' }
): Promise<Account> {
  const existing = inflightQuota.get(accountId)
  if (existing) return existing
  const job = refreshAccountQuotaInner(accountId, opts).finally(() => inflightQuota.delete(accountId))
  inflightQuota.set(accountId, job)
  return job
}

async function refreshAccountQuotaInner(
  accountId: string,
  opts?: { sync?: 'auto' | 'force' | 'never' }
): Promise<Account> {
  const acc = getAccount(accountId)
  if (!acc) throw new Error('账号不存在')
  if (!supportsQuota(acc.platform)) throw new Error(`${acc.platform} 没有可查询的订阅额度`)

  const sync = opts?.sync ?? 'auto'
  const locked = isProfileBusy(acc.profileDir)
  const secrets = revealSecrets(accountId)
  const hasToken = !!(
    acc.customFields.sessionToken ||
    acc.customFields.sessionKey ||
    acc.customFields.apiKey ||
    secrets.refreshToken
  )
  if (locked && !hasToken && acc.platform !== 'kiro' && acc.platform !== 'antigravity') {
    throw new Error('请先关掉该账号的浏览器窗口，再点刷新额度（才能抓登录会话）')
  }
  if (sync === 'force' && !locked) await syncSessionIfIdle(accountId)

  let quota: AccountQuota
  try {
    quota = await fetchQuotaFor(accountId)
  } catch (e) {
    if (sync === 'auto' && !locked && acc.platform !== 'kiro' && acc.platform !== 'antigravity' && isAuthError(e)) {
      await syncSessionIfIdle(accountId)
      try {
        quota = await fetchQuotaFor(accountId)
      } catch (retryErr) {
        quota = failedQuota(getAccount(accountId) || acc, (retryErr as Error).message)
      }
    } else {
      quota = failedQuota(acc, (e as Error).message)
    }
  }
  const accNow = getAccount(accountId) || acc
  const email = quota.email && looksLikeEmail(quota.email) ? quota.email : ''
  const saved = updateAccount(accountId, {
    quota,
    ...(email && email !== accNow.email ? { email, label: accNow.email ? accNow.label : email } : {})
  })
  const enriched = (await enrichAccountIdentity(accountId)) || saved
  try {
    recordQuotaSnapshot(enriched)
  } catch (e) {
    logger.warn('quota', `额度快照写入失败: ${(e as Error).message}`, { accountId })
  }
  return enriched
}

export type QuotaProgress = {
  account: Account
  done: number
  total: number
}

let quotaBatchRunning = false

export async function refreshAccountQuotas(
  ids: string[],
  opts?: { onProgress?: (p: QuotaProgress) => void; concurrency?: number }
): Promise<Account[]> {
  if (quotaBatchRunning) throw new Error('额度查询正在进行，请等这轮结束')
  quotaBatchRunning = true
  try {
    const unique = [...new Set(ids)]
    const rows = unique
      .map((id) => getAccount(id))
      .filter((a): a is Account => !!a && supportsQuota(a.platform))
    rows.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      return (b.lastUsedAt || 0) - (a.lastUsedAt || 0)
    })
    const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 3, 4))
    const out: Account[] = []
    let cursor = 0
    let done = 0

    const worker = async (offset: number): Promise<void> => {
      await sleep(offset * 180 + jitter(40, 120))
      while (true) {
        const i = cursor++
        if (i >= rows.length) return
        await sleep(jitter(160, 420))
        const acc = await refreshAccountQuota(rows[i].id, { sync: 'auto' })
        out.push(acc)
        done += 1
        opts?.onProgress?.({ account: acc, done, total: rows.length })
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, (_, i) => worker(i)))
    return out
  } finally {
    quotaBatchRunning = false
  }
}
