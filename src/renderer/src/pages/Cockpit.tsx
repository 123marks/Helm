import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpDown,
  CircleSlash,
  Clock,
  RefreshCw,
  Search,
  Timer,
  Wallet
} from 'lucide-react'
import { toast } from 'sonner'
import type { Platform, QuotaHistorySeries } from '@shared/types'
import { hasQuota } from '@shared/platformFlags'
import { planDisplayName, planKindOf } from '@shared/membership'
import { planMonthlyUsd } from '@shared/planCatalog'
import { accountUsage, countdown, USAGE_TONE, type UsageState } from '@shared/quotaSummary'
import { accountTitle, maskEmail } from '@shared/accountDisplay'
import { looksLikeEmail } from '@shared/identity'
import { api } from '@renderer/lib/api'
import { platformMeta, PLATFORMS } from '@renderer/lib/platforms'
import { relativeTime } from '@renderer/lib/utils'
import { useAccountsStore } from '@renderer/store/accounts'
import { useAppStore } from '@renderer/store/app'
import { usePrivacyStore } from '@renderer/store/privacy'
import { PlatformGlyph } from '@renderer/components/PlatformBadge'
import { MembershipBadge } from '@renderer/components/MembershipBadge'
import { TrendChart, type TrendSeries } from '@renderer/components/charts'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Card, CardContent } from '@renderer/components/ui/card'
import { EmptyState } from '@renderer/components/ui/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

type SortKey = 'usage' | 'reset' | 'platform' | 'plan' | 'checked' | 'cost'

const RANGES = [
  { days: 1, label: '24h' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' }
] as const

const REFRESH_OPTIONS = [
  { minutes: 0, label: '手动' },
  { minutes: 15, label: '15m' },
  { minutes: 30, label: '30m' },
  { minutes: 60, label: '1h' },
  { minutes: 360, label: '6h' }
] as const

const COL = 'grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,2fr)_78px_86px_92px_36px]'

function usageBarTone(p: number | null): string {
  if (p == null) return 'bg-muted-foreground/30'
  if (p >= 95) return 'bg-gradient-to-r from-rose-500 to-red-400'
  if (p >= 80) return 'bg-gradient-to-r from-amber-400 to-yellow-300'
  return 'bg-gradient-to-r from-emerald-500 to-teal-300'
}

function money(v: number): string {
  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2).replace(/\.00$/, '')}`
}

function UsageBar({ percent }: { percent: number | null }): React.JSX.Element {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
      <div
        className={`h-full rounded-full transition-all ${usageBarTone(percent)}`}
        style={{ width: `${percent ?? 0}%` }}
      />
    </div>
  )
}

/** Compact pill group, the shape used across this page's toolbars. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  title
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  title?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center rounded-lg border bg-card/60 p-0.5" title={title}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function HeroMetric({
  label,
  value,
  tone
}: {
  label: string
  value: React.ReactNode
  tone?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 px-4">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
    </div>
  )
}

function StateChip({
  label,
  count,
  total,
  state,
  active,
  onClick
}: {
  label: string
  count: number
  total: number
  state: UsageState
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const tone = USAGE_TONE[state]
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
        active ? 'border-primary/50 bg-primary/10' : 'hover:bg-accent/50'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums ${tone.text}`}>{count}</div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div className={`h-full rounded-full ${tone.dot}`} style={{ width: `${pct}%` }} />
      </div>
    </button>
  )
}

export default function Cockpit(): React.JSX.Element {
  const accounts = useAccountsStore((s) => s.accounts)
  const replace = useAccountsStore((s) => s.replace)
  const openDetail = useAppStore((s) => s.openDetail)
  const setPage = useAppStore((s) => s.setPage)
  const autoMinutes = useAppStore((s) => s.settings?.quotaAutoRefreshMinutes ?? 0)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const revealed = usePrivacyStore((s) => s.revealed)

  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [state, setState] = useState<UsageState | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('usage')
  const [range, setRange] = useState<number>(7)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [history, setHistory] = useState<QuotaHistorySeries | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const loadHistory = useCallback(
    (days: number) => {
      void api.automation
        .quotaHistory(days)
        .then(setHistory)
        .catch(() => setHistory(null))
    },
    []
  )

  useEffect(() => loadHistory(range), [range, loadHistory])

  useEffect(() => {
    return api.automation.onQuotaUpdated((e) => {
      if (e.account) replace(e.account)
      setSyncing((prev) => {
        const next = new Set(prev)
        if (e.phase === 'start') next.add(e.accountId)
        else next.delete(e.accountId)
        return next
      })
      if (e.done != null && e.total != null) {
        setProgress(e.done >= e.total ? null : { done: e.done, total: e.total })
      }
      if (e.phase === 'done') loadHistory(range)
    })
  }, [replace, loadHistory, range])

  const tracked = useMemo(() => accounts.filter((a) => hasQuota(a.platform)), [accounts])
  const rows = useMemo(
    () =>
      tracked.map((a) => ({
        account: a,
        usage: accountUsage(a),
        monthly: planMonthlyUsd(a.platform, a.quota?.plan || '')
      })),
    [tracked]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = rows.filter((r) => {
      if (platform !== 'all' && r.account.platform !== platform) return false
      if (state !== 'all' && r.usage.state !== state) return false
      if (!q) return true
      const a = r.account
      return (
        a.label.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.quota?.plan ?? '').toLowerCase().includes(q) ||
        a.groupName.toLowerCase().includes(q)
      )
    })
    const score = (v: number | null): number => (v == null ? -1 : v)
    list.sort((x, y) => {
      if (sort === 'usage') return score(y.usage.peak ?? y.usage.percent) - score(x.usage.peak ?? x.usage.percent)
      if (sort === 'reset') return (x.usage.resetAt ?? Infinity) - (y.usage.resetAt ?? Infinity)
      if (sort === 'checked') return (y.usage.fetchedAt ?? 0) - (x.usage.fetchedAt ?? 0)
      if (sort === 'cost') return score(y.monthly) - score(x.monthly)
      if (sort === 'plan') return (x.account.quota?.plan ?? '').localeCompare(y.account.quota?.plan ?? '')
      return x.account.platform.localeCompare(y.account.platform)
    })
    return list
  }, [rows, search, platform, state, sort])

  const stats = useMemo(() => {
    const counts: Record<UsageState, number> = {
      ok: 0,
      warn: 0,
      critical: 0,
      error: 0,
      stale: 0,
      unknown: 0
    }
    let sum = 0
    let n = 0
    let monthly = 0
    let paid = 0
    let soonest: number | null = null
    for (const r of rows) {
      counts[r.usage.state] += 1
      const p = r.usage.peak ?? r.usage.percent
      if (p != null) {
        sum += p
        n += 1
      }
      if (r.monthly != null && r.monthly > 0) {
        monthly += r.monthly
        paid += 1
      }
      if (r.usage.resetAt && (soonest == null || r.usage.resetAt < soonest)) soonest = r.usage.resetAt
    }
    return {
      counts,
      average: n ? sum / n : null,
      soonest,
      total: rows.length,
      monthly,
      paid,
      alerts: counts.warn + counts.critical
    }
  }, [rows])

  const byPlatform = useMemo(() => {
    const map = new Map<Platform, { count: number; sum: number; scored: number; alerts: number; monthly: number }>()
    for (const r of rows) {
      const cur = map.get(r.account.platform) ?? { count: 0, sum: 0, scored: 0, alerts: 0, monthly: 0 }
      cur.count += 1
      const p = r.usage.peak ?? r.usage.percent
      if (p != null) {
        cur.sum += p
        cur.scored += 1
      }
      if (r.usage.state === 'warn' || r.usage.state === 'critical') cur.alerts += 1
      cur.monthly += r.monthly ?? 0
      map.set(r.account.platform, cur)
    }
    return [...map.entries()]
      .map(([key, v]) => ({
        key,
        meta: platformMeta(key),
        count: v.count,
        alerts: v.alerts,
        monthly: v.monthly,
        average: v.scored ? v.sum / v.scored : null
      }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

  const trend = useMemo<{ labels: string[]; all: TrendSeries[] }>(() => {
    if (!history || history.points.length === 0) return { labels: [], all: [] }
    const daily = history.stepMs >= 86_400_000
    const labels = history.points.map((p) => {
      const d = new Date(p.ts)
      return daily
        ? `${d.getMonth() + 1}/${d.getDate()}`
        : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    })
    const top = byPlatform.slice(0, 4).map((p) => p.key)
    const series: TrendSeries[] = [
      {
        key: 'all',
        label: '全部账号',
        color: 'hsl(var(--primary))',
        points: history.points.map((p) => p.average)
      },
      ...top
        .filter((key) => history.platforms.includes(key))
        .map((key) => ({
          key,
          label: platformMeta(key).label,
          color: platformMeta(key).color === '#000000' ? '#94a3b8' : platformMeta(key).color,
          points: history.points.map((p) => p.byPlatform[key] ?? null)
        }))
    ]
    return { labels, all: series }
  }, [history, byPlatform])

  const visibleSeries = useMemo(
    () => trend.all.filter((s) => !hidden.has(s.key)),
    [trend.all, hidden]
  )

  const refreshAll = async (ids: string[], label: string): Promise<void> => {
    if (ids.length === 0) {
      toast.error('没有可查询额度的账号')
      return
    }
    setBusy(true)
    setProgress({ done: 0, total: ids.length })
    try {
      const next = await api.automation.refreshQuotas(ids)
      next.forEach(replace)
      const failed = next.filter((a) => a.quota?.error).length
      if (failed) toast.warning(`${label}完成，${failed} 个失败`)
      else toast.success(`${label}完成，共 ${next.length} 个`)
      loadHistory(range)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const refreshOne = async (id: string): Promise<void> => {
    setSyncing((p) => new Set(p).add(id))
    try {
      replace(await api.automation.refreshQuota(id))
      loadHistory(range)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSyncing((p) => {
        const n = new Set(p)
        n.delete(id)
        return n
      })
    }
  }

  const alerts = rows
    .filter((r) => r.usage.state === 'critical' || r.usage.state === 'warn')
    .sort((a, b) => (b.usage.peak ?? 0) - (a.usage.peak ?? 0))
    .slice(0, 7)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">
          {stats.total} 个可查额度的账号
          {progress ? ` · 正在刷新 ${progress.done}/${progress.total}` : ''}
        </p>
        <Segmented
          title="趋势时间范围"
          value={range}
          onChange={setRange}
          options={RANGES.map((r) => ({ value: r.days, label: r.label }))}
        />
        <Segmented
          title="后台自动刷新间隔"
          value={autoMinutes}
          onChange={(v) => void saveSettings({ quotaAutoRefreshMinutes: v })}
          options={REFRESH_OPTIONS.map((r) => ({ value: r.minutes, label: r.label }))}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void refreshAll(filtered.map((r) => r.account.id), '刷新当前筛选')}
        >
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> 刷新筛选
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void refreshAll(tracked.map((a) => a.id), '刷新全部额度')}>
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> 刷新全部
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-y-4 p-5">
            <div className="flex min-w-0 items-center gap-3.5 pr-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                <Wallet className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">月订阅成本</div>
                <div className="text-3xl font-bold leading-tight tabular-nums">
                  {money(stats.monthly)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/月</span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                  {stats.paid} 个付费号 · {stats.total - stats.paid} 个免费或未知
                </div>
              </div>
            </div>
            <div className="flex flex-1 items-center divide-x divide-border/60 border-l border-border/60">
              <HeroMetric
                label="平均用量"
                value={stats.average == null ? '—' : `${Math.round(stats.average)}%`}
              />
              <HeroMetric
                label="告警账号"
                value={stats.alerts}
                tone={stats.alerts > 0 ? 'text-amber-300' : undefined}
              />
              <HeroMetric label="最近重置" value={countdown(stats.soonest)} />
              <HeroMetric
                label="查询失败"
                value={stats.counts.error}
                tone={stats.counts.error > 0 ? 'text-orange-300' : undefined}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t bg-muted/20 p-3 sm:grid-cols-4">
            <StateChip
              label="正常"
              state="ok"
              count={stats.counts.ok}
              total={stats.total}
              active={state === 'ok'}
              onClick={() => setState(state === 'ok' ? 'all' : 'ok')}
            />
            <StateChip
              label="接近上限"
              state="warn"
              count={stats.counts.warn}
              total={stats.total}
              active={state === 'warn'}
              onClick={() => setState(state === 'warn' ? 'all' : 'warn')}
            />
            <StateChip
              label="已耗尽"
              state="critical"
              count={stats.counts.critical}
              total={stats.total}
              active={state === 'critical'}
              onClick={() => setState(state === 'critical' ? 'all' : 'critical')}
            />
            <StateChip
              label="待刷新"
              state="stale"
              count={stats.counts.stale}
              total={stats.total}
              active={state === 'stale'}
              onClick={() => setState(state === 'stale' ? 'all' : 'stale')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-primary" /> 使用趋势
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
              {trend.all.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() =>
                    setHidden((prev) => {
                      const next = new Set(prev)
                      if (next.has(s.key)) next.delete(s.key)
                      else next.add(s.key)
                      return next
                    })
                  }
                  className={`flex items-center gap-1.5 text-[11px] transition-opacity ${
                    hidden.has(s.key) ? 'opacity-40' : ''
                  }`}
                  title={hidden.has(s.key) ? '点击显示' : '点击隐藏'}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-muted-foreground">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
          <TrendChart
            labels={trend.labels}
            series={visibleSeries}
            height={210}
            emptyHint="还没有历史数据。刷新几次额度后，这里会画出用量随时间的变化。"
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-3 text-sm font-semibold">平台用量</div>
            {byPlatform.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">还没有可查询额度的账号。</p>
            ) : (
              <div className="space-y-2.5">
                {byPlatform.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPlatform(platform === p.key ? 'all' : p.key)}
                    className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60 ${
                      platform === p.key ? 'bg-accent/70' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <PlatformGlyph platform={p.key} size={20} />
                      <span className="flex-1 truncate">{p.meta.label}</span>
                      {p.alerts > 0 && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] text-amber-300">
                          {p.alerts} 告警
                        </span>
                      )}
                      <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                        {p.monthly > 0 ? `${money(p.monthly)}/月` : '免费'}
                      </span>
                      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                        {p.count} 号
                      </span>
                      <span className="w-11 text-right text-xs font-medium tabular-nums">
                        {p.average == null ? '—' : `${Math.round(p.average)}%`}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <UsageBar percent={p.average} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-warning" /> 需要关注
            </div>
            {alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">所有账号额度都还宽裕。</p>
            ) : (
              <div className="space-y-1">
                {alerts.map(({ account, usage }) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => openDetail(account.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
                  >
                    <PlatformGlyph platform={account.platform} size={18} />
                    <span className="min-w-0 flex-1 truncate text-xs">{accountTitle(account)}</span>
                    <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {countdown(usage.resetAt)}
                    </span>
                    <span
                      className={`w-9 shrink-0 text-right text-xs font-semibold tabular-nums ${USAGE_TONE[usage.state].text}`}
                    >
                      {Math.round(usage.peak ?? 0)}%
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-60">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索账号 / 套餐 / 分组"
            className="pl-9"
          />
        </div>
        <Select value={platform} onValueChange={(v) => setPlatform(v as Platform | 'all')}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部平台</SelectItem>
            {PLATFORMS.filter((p) => hasQuota(p.key)).map((p) => (
              <SelectItem key={p.key} value={p.key} textValue={p.label}>
                <span className="flex items-center gap-2">
                  <PlatformGlyph platform={p.key} size={16} />
                  {p.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={(v) => setState(v as UsageState | 'all')}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="critical">已耗尽</SelectItem>
            <SelectItem value="warn">接近上限</SelectItem>
            <SelectItem value="ok">正常</SelectItem>
            <SelectItem value="stale">待刷新</SelectItem>
            <SelectItem value="error">查询失败</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-40">
            <span className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="usage">按用量从高到低</SelectItem>
            <SelectItem value="reset">按最近重置</SelectItem>
            <SelectItem value="checked">按最近查询</SelectItem>
            <SelectItem value="cost">按月成本</SelectItem>
            <SelectItem value="plan">按套餐</SelectItem>
            <SelectItem value="platform">按平台</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">共 {filtered.length} 条</span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={CircleSlash}
            title="没有匹配的账号"
            description="调整筛选条件，或先到「账号管理」添加带订阅额度的账号。"
            action={
              <Button size="sm" variant="outline" onClick={() => setPage('accounts')}>
                去账号管理
              </Button>
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div
            className={`grid ${COL} items-center gap-3 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium text-muted-foreground`}
          >
            <span>账号</span>
            <span>套餐</span>
            <span>用量</span>
            <span className="text-right">月成本</span>
            <span className="text-right">重置</span>
            <span className="text-right">最近查询</span>
            <span />
          </div>
          <div className="divide-y divide-border/60">
            {filtered.map(({ account, usage, monthly }) => {
              const tone = USAGE_TONE[usage.state]
              const raw = accountTitle(account)
              const name = looksLikeEmail(raw) ? maskEmail(raw, revealed) : raw
              const plan = account.quota?.plan || ''
              return (
                <div
                  key={account.id}
                  className={`grid ${COL} items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40`}
                >
                  <button
                    type="button"
                    onClick={() => openDetail(account.id)}
                    className="flex min-w-0 items-center gap-2 text-left"
                    title="查看详情"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} title={tone.label} />
                    <PlatformGlyph platform={account.platform} size={20} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {platformMeta(account.platform).label}
                        {account.groupName ? ` · ${account.groupName}` : ''}
                      </span>
                    </span>
                  </button>

                  <div className="flex min-w-0 items-center gap-1.5">
                    <MembershipBadge platform={account.platform} quota={account.quota} />
                    <span className="truncate text-[11px] text-muted-foreground">
                      {plan
                        ? planDisplayName(
                            account.platform,
                            plan,
                            planKindOf(account.platform, plan, account.quota?.planKind)
                          )
                        : '未知'}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-muted-foreground">
                        {account.quota?.error ? account.quota.error : (usage.primary?.label ?? '暂无额度数据')}
                      </span>
                      <span className={`shrink-0 tabular-nums ${tone.text}`}>
                        {usage.percent == null ? tone.label : `${Math.round(usage.percent)}%`}
                      </span>
                    </div>
                    <div className="mt-1">
                      <UsageBar percent={usage.percent} />
                    </div>
                  </div>

                  <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                    {monthly == null ? '—' : monthly === 0 ? '免费' : money(monthly)}
                  </span>
                  <span className="flex items-center justify-end gap-1 text-right text-[11px] tabular-nums text-muted-foreground">
                    {usage.resetAt && <Timer className="h-3 w-3 opacity-50" />}
                    {countdown(usage.resetAt)}
                  </span>
                  <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                    {relativeTime(usage.fetchedAt)}
                  </span>
                  <button
                    type="button"
                    title="刷新该账号额度"
                    className="justify-self-end rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    onClick={() => void refreshOne(account.id)}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${syncing.has(account.id) ? 'animate-spin text-primary' : ''}`}
                    />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
