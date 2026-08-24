import type { Account, QuotaMeter } from './types'
import { meterPercent, meterWorthShowing } from './membership'

export type UsageState = 'ok' | 'warn' | 'critical' | 'error' | 'stale' | 'unknown'

export interface AccountUsage {
  /** Headline usage 0–100, from the account's primary pool. */
  percent: number | null
  /** Worst meter on the account; what the alert list sorts by. */
  peak: number | null
  primary?: QuotaMeter
  /** Soonest upcoming reset across all meters. */
  resetAt: number | null
  fetchedAt: number | null
  state: UsageState
}

const WARN_AT = 80
const CRITICAL_AT = 95

/** Meters that are real pools, i.e. worth counting towards a usage figure. */
export function usableMeters(account: Account): QuotaMeter[] {
  return (account.quota?.meters ?? []).filter((m) => !m.detail && !m.info && meterWorthShowing(m))
}

export function accountUsage(account: Account, staleAfterMs = 6 * 3600_000): AccountUsage {
  const q = account.quota
  if (!q) {
    return { percent: null, peak: null, resetAt: null, fetchedAt: null, state: 'unknown' }
  }
  const meters = usableMeters(account)
  const primary = meters.find((m) => m.id === 'included') ?? meters[0]
  const percents = meters.map(meterPercent).filter((p): p is number => p != null)
  const peak = percents.length ? Math.max(...percents) : null
  const headline =
    (primary ? meterPercent(primary) : null) ??
    (q.used != null && q.limit != null && q.limit > 0
      ? Math.min(100, (q.used / q.limit) * 100)
      : null) ??
    peak
  const resets = meters
    .map((m) => m.resetAt)
    .concat(q.resetAt ?? null)
    .filter((t): t is number => !!t && t > Date.now())
  const resetAt = resets.length ? Math.min(...resets) : (q.resetAt ?? null)

  let state: UsageState = 'unknown'
  if (q.error) state = 'error'
  else if (peak == null && headline == null) state = q.plan ? 'stale' : 'unknown'
  else {
    const worst = Math.max(peak ?? 0, headline ?? 0)
    state = worst >= CRITICAL_AT ? 'critical' : worst >= WARN_AT ? 'warn' : 'ok'
  }
  if (state === 'ok' && q.fetchedAt && Date.now() - q.fetchedAt > staleAfterMs) state = 'stale'

  return { percent: headline, peak, primary, resetAt, fetchedAt: q.fetchedAt ?? null, state }
}

export const USAGE_TONE: Record<UsageState, { label: string; text: string; bg: string; dot: string }> = {
  ok: { label: '正常', text: 'text-emerald-300', bg: 'bg-emerald-500/15', dot: 'bg-emerald-400' },
  warn: { label: '接近上限', text: 'text-amber-300', bg: 'bg-amber-500/15', dot: 'bg-amber-400' },
  critical: { label: '已耗尽', text: 'text-rose-300', bg: 'bg-rose-500/15', dot: 'bg-rose-400' },
  error: { label: '查询失败', text: 'text-orange-300', bg: 'bg-orange-500/15', dot: 'bg-orange-400' },
  stale: { label: '待刷新', text: 'text-sky-300', bg: 'bg-sky-500/15', dot: 'bg-sky-400' },
  unknown: { label: '未知', text: 'text-muted-foreground', bg: 'bg-muted', dot: 'bg-muted-foreground/50' }
}

/** `2h 15m` style countdown used by the reset column. */
export function countdown(target: number | null): string {
  if (!target) return '—'
  const ms = target - Date.now()
  if (ms <= 0) return '已重置'
  const mins = Math.floor(ms / 60_000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins % 60}m`
  return `${mins}m`
}
