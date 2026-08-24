import type { PlanKind, Platform, QuotaMeter } from './types'
import { resolvePlanTier, type PlanTier } from './planCatalog'

/** Last-resort guess when the platform is unknown or the catalog has no match. */
export function inferPlanKind(plan: string): PlanKind {
  const p = (plan || '').toLowerCase().replace(/[_-]+/g, ' ')
  if (!p) return 'unknown'
  if (/\benterprise\b/.test(p)) return 'enterprise'
  if (/\bpower\b/.test(p)) return 'power'
  if (/\bpro max\b/.test(p)) return 'pro_max'
  if (/\bmax\b/.test(p)) return 'max'
  if (/\b(ultra|heavy)\b/.test(p)) return 'ultra'
  if (/\b(business|team|teams)\b/.test(p)) return 'team'
  if (/\b(pro plus|pro\+|proplus|supergrok plus|chatgpt pro)\b/.test(p)) return 'pro_plus'
  if (/\b(plus|chatgptplus|chatgpt plus)\b/.test(p) && !/\bpro\b/.test(p)) return 'plus'
  if (/\b(pro|supergrok|individual)\b/.test(p)) return 'pro'
  if (/\bgo\b/.test(p)) return 'go'
  if (/\blite\b/.test(p)) return 'lite'
  if (/\b(free|hobby|starter|basic|chatgptfree)\b/.test(p)) return 'free'
  return 'unknown'
}

/** Resolve the catalog tier for an account, falling back to a generic guess. */
export function planTierOf(platform: Platform, plan: string): PlanTier | null {
  return resolvePlanTier(platform, plan)
}

export function planKindOf(platform: Platform, plan: string, hint?: PlanKind): PlanKind {
  if (hint && hint !== 'unknown') return hint
  return resolvePlanTier(platform, plan)?.kind ?? inferPlanKind(plan)
}

export function planBadgeLabel(kind: PlanKind, plan: string): string {
  const raw = (plan || '').trim()
  if (kind === 'power') return 'POWER'
  if (kind === 'pro_max') return 'PRO MAX'
  if (kind === 'max') return 'MAX'
  if (kind === 'ultra') return /heavy/i.test(raw) ? 'HEAVY' : 'ULTRA'
  if (kind === 'enterprise') return 'ENTERPRISE'
  if (kind === 'pro_plus') return 'PRO+'
  if (kind === 'team') return /business/i.test(raw) ? 'BUSINESS' : 'TEAM'
  if (kind === 'plus') return 'PLUS'
  if (kind === 'go') return 'GO'
  if (kind === 'lite') return 'LITE'
  if (kind === 'pro') return /supergrok/i.test(raw) ? 'SUPERGROK' : 'PRO'
  if (kind === 'free') return 'FREE'
  return raw ? raw.slice(0, 12).toUpperCase() : 'MEMBER'
}

/** Short uppercase badge; prefers the platform's own tier naming. */
export function planBadgeFor(platform: Platform, plan: string, hint?: PlanKind): string {
  return resolvePlanTier(platform, plan)?.badge ?? planBadgeLabel(planKindOf(platform, plan, hint), plan)
}

export function loginMethodLabel(method?: string, fallback?: string): string {
  const m = (method || fallback || '').toLowerCase()
  if (!m) return ''
  if (m.includes('google')) return '使用 Google 登录'
  if (m.includes('github')) return '使用 GitHub 登录'
  if (m.includes('apple')) return '使用 Apple 登录'
  if (m.includes('microsoft') || m.includes('azure')) return '使用 Microsoft 登录'
  if (m.includes('x.com') || m === 'x' || m.includes('twitter')) return '使用 X 登录'
  if (m.includes('password') || m.includes('email')) return '使用密码登录'
  if (m.includes('oauth') || m.includes('sso') || m.includes('token')) return '授权登录'
  return ''
}

export function includedMeter(meters?: QuotaMeter[]): QuotaMeter | undefined {
  return meters?.find((m) => m.id === 'included') || meters?.[0]
}

export function premiumMeter(meters?: QuotaMeter[]): QuotaMeter | undefined {
  return meters?.find((m) => m.id === 'premium' || m.id === 'ondemand')
}

/** Official tier name, with the public list price appended when we know it. */
export function planDisplayName(platform: Platform, plan: string, kind?: PlanKind): string {
  const tier = resolvePlanTier(platform, plan)
  if (tier) return tier.price ? `${tier.label} · ${tier.price}` : tier.label
  const raw = (plan || '').trim()
  if (raw) return raw
  return kind && kind !== 'unknown' ? planBadgeLabel(kind, raw) : '订阅'
}

/** One-line explanation of what the tier includes, shown under the plan name. */
export function planNote(platform: Platform, plan: string): string {
  return resolvePlanTier(platform, plan)?.note ?? ''
}

const PANEL_FRAME: Partial<Record<PlanKind, string>> = {
  free: 'quota-panel-free',
  lite: 'quota-panel-lite',
  go: 'quota-panel-lite',
  plus: 'quota-panel-plus',
  pro: 'quota-panel-pro',
  pro_plus: 'quota-panel-proplus',
  pro_max: 'quota-panel-promax',
  max: 'quota-panel-max',
  ultra: 'quota-panel-ultra',
  power: 'quota-panel-power',
  team: 'quota-panel-team',
  enterprise: 'quota-panel-ent'
}

export function planPanelFrame(kind?: PlanKind | null): string {
  const extra = kind ? PANEL_FRAME[kind] : undefined
  return extra ? `quota-panel ${extra}` : 'quota-panel'
}

const CARD_FRAME: Partial<Record<PlanKind, string>> = {
  ultra: 'border border-violet-400/55 shadow-[0_0_0_1px_rgba(167,139,250,0.28),0_10px_28px_rgba(139,92,246,0.16)]',
  power: 'border border-fuchsia-400/55 shadow-[0_0_0_1px_rgba(232,121,249,0.28),0_10px_28px_rgba(217,70,239,0.16)]',
  max: 'border border-rose-400/55 shadow-[0_0_0_1px_rgba(251,113,133,0.26),0_10px_26px_rgba(244,63,94,0.14)]',
  pro_max: 'border border-orange-400/55 shadow-[0_0_0_1px_rgba(251,146,60,0.26),0_9px_24px_rgba(249,115,22,0.14)]',
  pro_plus: 'border border-yellow-300/60 shadow-[0_0_0_1px_rgba(253,224,71,0.28),0_8px_24px_rgba(250,204,21,0.16)]',
  pro: 'border border-amber-400/50 shadow-[0_0_0_1px_rgba(251,191,36,0.22),0_8px_22px_rgba(251,191,36,0.12)]',
  plus: 'border border-sky-400/50 shadow-[0_0_0_1px_rgba(56,189,248,0.22),0_8px_22px_rgba(56,189,248,0.12)]',
  go: 'border border-teal-400/50 shadow-[0_0_0_1px_rgba(45,212,191,0.2),0_8px_20px_rgba(20,184,166,0.1)]',
  lite: 'border border-teal-400/45 shadow-[0_0_0_1px_rgba(45,212,191,0.18)]',
  team: 'border border-indigo-400/50 shadow-[0_0_0_1px_rgba(129,140,248,0.22),0_8px_22px_rgba(99,102,241,0.12)]',
  enterprise: 'border border-slate-200/40 shadow-[0_0_0_1px_rgba(226,232,240,0.18),0_8px_20px_rgba(148,163,184,0.1)]',
  free: 'border border-zinc-600/70'
}

export function planCardFrame(kind?: PlanKind | null): string {
  return (kind && CARD_FRAME[kind]) || 'border'
}

export function meterWorthShowing(row: QuotaMeter): boolean {
  if (row.info) return true
  if (row.unlimited) return true
  if (row.unit === '%' && row.used != null) return true
  if (row.limit != null && row.limit > 0) return true
  if (row.used != null && row.used > 0) return true
  return false
}

/** 0–100 usage for a meter, or null when the meter has no comparable scale. */
export function meterPercent(row: QuotaMeter): number | null {
  if (row.info || row.unlimited) return null
  if (row.unit === '%') return row.used == null ? null : Math.min(100, Math.max(0, row.used))
  if (row.used == null || row.limit == null || row.limit <= 0) return null
  return Math.min(100, Math.max(0, (row.used / row.limit) * 100))
}
