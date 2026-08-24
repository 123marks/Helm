import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpDown,
  BatteryCharging,
  CircleSlash,
  RefreshCw,
  Search,
  Timer,
  Users
} from 'lucide-react'
import { toast } from 'sonner'
import type { Account, Platform } from '@shared/types'
import { hasQuota } from '@shared/platformFlags'
import { planDisplayName, planKindOf } from '@shared/membership'
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
import { StatCard } from '@renderer/components/StatCard'
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

type SortKey = 'usage' | 'reset' | 'platform' | 'plan' | 'checked'

function usageBarTone(p: number | null): string {
  if (p == null) return 'bg-muted-foreground/30'
  if (p >= 95) return 'bg-gradient-to-r from-rose-500 to-red-400'
  if (p >= 80) return 'bg-gradient-to-r from-amber-400 to-yellow-300'
  return 'bg-gradient-to-r from-emerald-500 to-teal-300'
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
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

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
    })
  }, [replace])

  const tracked = useMemo(() => accounts.filter((a) => hasQuota(a.platform)), [accounts])

  const rows = useMemo(() => {
    return tracked.map((a) => ({ account: a, usage: accountUsage(a) }))
  }, [tracked])

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
    const byUsage = (v: number | null): number => (v == null ? -1 : v)
    list.sort((x, y) => {
      if (sort === 'usage') return byUsage(y.usage.peak ?? y.usage.percent) - byUsage(x.usage.peak ?? x.usage.percent)
      if (sort === 'reset') return (x.usage.resetAt ?? Infinity) - (y.usage.resetAt ?? Infinity)
      if (sort === 'checked') return (y.usage.fetchedAt ?? 0) - (x.usage.fetchedAt ?? 0)
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
    let soonest: number | null = null
    for (const r of rows) {
      counts[r.usage.state] += 1
      const p = r.usage.peak ?? r.usage.percent
      if (p != null) {
        sum += p
        n += 1
      }
      if (r.usage.resetAt && (soonest == null || r.usage.resetAt < soonest)) soonest = r.usage.resetAt
    }
    return { counts, average: n ? sum / n : null, soonest, total: rows.length }
  }, [rows])

  const byPlatform = useMemo(() => {
    const map = new Map<Platform, { count: number; sum: number; scored: number; alerts: number }>()
    for (const r of rows) {
      const cur = map.get(r.account.platform) ?? { count: 0, sum: 0, scored: 0, alerts: 0 }
      cur.count += 1
      const p = r.usage.peak ?? r.usage.percent
      if (p != null) {
        cur.sum += p
        cur.scored += 1
      }
      if (r.usage.state === 'warn' || r.usage.state === 'critical') cur.alerts += 1
      map.set(r.account.platform, cur)
    }
    return [...map.entries()]
      .map(([key, v]) => ({
        key,
        meta: platformMeta(key),
        count: v.count,
        alerts: v.alerts,
        average: v.scored ? v.sum / v.scored : null
      }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

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
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const alerts = rows
    .filter((r) => r.usage.state === 'critical' || r.usage.state === 'warn')
    .sort((a, b) => (b.usage.peak ?? 0) - (a.usage.peak ?? 0))
    .slice(0, 6)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">
          {stats.total} 个可查额度的账号
          {progress ? ` · 正在刷新 ${progress.done}/${progress.total}` : ''}
        </p>
        <Select
          value={String(autoMinutes)}
          onValueChange={(v) => void saveSettings({ quotaAutoRefreshMinutes: Number(v) })}
        >
          <SelectTrigger className="w-36" title="后台自动刷新间隔">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">不自动刷新</SelectItem>
            <SelectItem value="15">每 15 分钟</SelectItem>
            <SelectItem value="30">每 30 分钟</SelectItem>
            <SelectItem value="60">每小时</SelectItem>
            <SelectItem value="360">每 6 小时</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void refreshAll(filtered.map((r) => r.account.id), '刷新当前筛选')}
        >
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> 刷新筛选结果
        </Button>
        <Button
          disabled={busy}
          onClick={() => void refreshAll(tracked.map((a) => a.id), '刷新全部额度')}
        >
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> 刷新全部
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="纳入监控的账号"
          value={stats.total}
          sub={`${stats.counts.ok} 正常 · ${stats.counts.stale} 待刷新`}
          icon={<Users className="h-5 w-5 text-primary" />}
          tone="hsl(var(--primary) / 0.15)"
        />
        <StatCard
          label="平均用量"
          value={stats.average == null ? '—' : `${Math.round(stats.average)}%`}
          sub="按各账号最吃紧的额度池计算"
          icon={<BatteryCharging className="h-5 w-5 text-success" />}
          tone="hsl(var(--success) / 0.15)"
        />
        <StatCard
          label="告警账号"
          value={stats.counts.warn + stats.counts.critical}
          sub={`${stats.counts.critical} 个已耗尽 · ${stats.counts.warn} 个接近上限`}
          icon={<AlertTriangle className="h-5 w-5 text-warning" />}
          tone="hsl(var(--warning) / 0.15)"
          onClick={() => setState(state === 'all' ? 'critical' : 'all')}
        />
        <StatCard
          label="最近一次重置"
          value={countdown(stats.soonest)}
          sub={stats.counts.error ? `${stats.counts.error} 个账号查询失败` : '额度窗口滚动刷新'}
          icon={<Timer className="h-5 w-5 text-destructive" />}
          tone="hsl(var(--destructive) / 0.15)"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
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
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-warning" /> 需要关注
            </div>
            {alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">所有账号额度都还宽裕。</p>
            ) : (
              <div className="space-y-2">
                {alerts.map(({ account, usage }) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => openDetail(account.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
                  >
                    <PlatformGlyph platform={account.platform} size={18} />
                    <span className="min-w-0 flex-1 truncate text-xs">{accountTitle(account)}</span>
                    <span
                      className={`shrink-0 text-xs font-semibold tabular-nums ${USAGE_TONE[usage.state].text}`}
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
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索账号 / 套餐 / 分组"
            className="pl-9"
          />
        </div>
        <Select value={platform} onValueChange={(v) => setPlatform(v as Platform | 'all')}>
          <SelectTrigger className="w-40">
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
          <SelectTrigger className="w-36">
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
            <SelectItem value="plan">按套餐</SelectItem>
            <SelectItem value="platform">按平台</SelectItem>
          </SelectContent>
        </Select>
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
          <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,2fr)_86px_96px_40px] items-center gap-3 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium text-muted-foreground">
            <span>账号</span>
            <span>套餐</span>
            <span>用量</span>
            <span className="text-right">重置</span>
            <span className="text-right">最近查询</span>
            <span />
          </div>
          <div className="divide-y divide-border/60">
            {filtered.map(({ account, usage }) => {
              const tone = USAGE_TONE[usage.state]
              const raw = accountTitle(account)
              const name = looksLikeEmail(raw) ? maskEmail(raw, revealed) : raw
              const plan = account.quota?.plan || ''
              return (
                <div
                  key={account.id}
                  className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,2fr)_86px_96px_40px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40"
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
                        {account.quota?.error
                          ? account.quota.error
                          : (usage.primary?.label ?? '暂无额度数据')}
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
                    {countdown(usage.resetAt)}
                  </span>
                  <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                    {relativeTime(usage.fetchedAt)}
                  </span>
                  <button
                    type="button"
                    title="刷新该账号额度"
                    className="justify-self-end rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    onClick={() => {
                      void (async () => {
                        setSyncing((p) => new Set(p).add(account.id))
                        try {
                          replace(await api.automation.refreshQuota(account.id))
                        } catch (e) {
                          toast.error((e as Error).message)
                        } finally {
                          setSyncing((p) => {
                            const n = new Set(p)
                            n.delete(account.id)
                            return n
                          })
                        }
                      })()
                    }}
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
