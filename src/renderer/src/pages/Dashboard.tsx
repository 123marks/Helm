import React from 'react'
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  Fingerprint,
  Gauge,
  ShieldCheck,
  Users,
  XCircle
} from 'lucide-react'
import type { Platform } from '@shared/types'
import { hasQuota } from '@shared/platformFlags'
import { accountUsage } from '@shared/quotaSummary'
import { useAccountsStore } from '@renderer/store/accounts'
import { useTasksStore } from '@renderer/store/tasks'
import { useAppStore } from '@renderer/store/app'
import { useSecurityStore } from '@renderer/store/security'
import { PlatformGlyph } from '@renderer/components/PlatformBadge'
import { ScoreRing } from '@renderer/components/ScoreRing'
import { StatCard } from '@renderer/components/StatCard'
import { Donut, DonutLegend, MiniBars, type BarPoint, type DonutSegment } from '@renderer/components/charts'
import { TaskStatusBadge } from '@renderer/components/status'
import { platformMeta, PLATFORMS } from '@renderer/lib/platforms'
import { relativeTime } from '@renderer/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Progress } from '@renderer/components/ui/progress'
import { Button } from '@renderer/components/ui/button'
import { EmptyState } from '@renderer/components/ui/empty-state'

function Coverage({
  label,
  value,
  total,
  hint
}: {
  label: string
  value: number
  total: number
  hint: string
}): React.JSX.Element {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums">
          {value}
          <span className="text-muted-foreground">/{total}</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  )
}

export default function Dashboard(): React.JSX.Element {
  const accounts = useAccountsStore((s) => s.accounts)
  const tasks = useTasksStore((s) => s.tasks)
  const setPage = useAppStore((s) => s.setPage)
  const report = useSecurityStore((s) => s.report)

  const active = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length
  const success = tasks.filter((t) => t.status === 'success').length
  const failed = tasks.filter((t) => t.status === 'failed').length
  const canceled = tasks.filter((t) => t.status === 'canceled').length

  const taskSegments: DonutSegment[] = [
    { label: '成功', value: success, color: 'hsl(var(--success))' },
    { label: '失败', value: failed, color: 'hsl(var(--destructive))' },
    { label: '进行中', value: active, color: 'hsl(var(--warning))' },
    { label: '已取消', value: canceled, color: 'hsl(var(--muted-foreground))' }
  ]

  const activity: BarPoint[] = (() => {
    const days = 14
    const dayMs = 86_400_000
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const base = startOfToday.getTime()
    const buckets: BarPoint[] = Array.from({ length: days }, (_, i) => {
      const d = new Date(base - (days - 1 - i) * dayMs)
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, value: 0 }
    })
    for (const t of tasks) {
      const idx = Math.floor((base - new Date(t.createdAt).setHours(0, 0, 0, 0)) / dayMs)
      if (idx >= 0 && idx < days) buckets[days - 1 - idx].value += 1
    }
    return buckets
  })()

  const riskCount = report
    ? report.totals.noPassword +
      report.totals.weakPassword +
      report.totals.reusedPassword +
      report.totals.no2fa +
      report.totals.noRecovery
    : 0

  const counts = new Map<Platform, number>()
  accounts.forEach((a) => counts.set(a.platform, (counts.get(a.platform) ?? 0) + 1))
  const distribution = PLATFORMS.map((p) => ({ ...p, count: counts.get(p.key) ?? 0 })).filter(
    (p) => p.count > 0
  )
  const recent = tasks.slice(0, 6)

  const total = accounts.length
  const withProxy = accounts.filter((a) => a.proxyUrl).length
  const withIdentity = accounts.filter((a) => a.userAgent || a.locale || a.timezone).length

  const quota = (() => {
    const rows = accounts.filter((a) => hasQuota(a.platform)).map((a) => accountUsage(a))
    const scored = rows.map((u) => u.peak ?? u.percent).filter((p): p is number => p != null)
    return {
      tracked: rows.length,
      alerts: rows.filter((u) => u.state === 'warn' || u.state === 'critical').length,
      average: scored.length ? scored.reduce((s, p) => s + p, 0) / scored.length : null
    }
  })()

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="账号总数"
          value={accounts.length}
          sub={quota.tracked > 0 ? `${quota.tracked} 个带订阅额度` : undefined}
          icon={<Users className="h-5 w-5 text-primary" />}
          tone="hsl(var(--primary) / 0.15)"
          onClick={() => setPage('accounts')}
        />
        <StatCard
          label="额度告警"
          value={quota.alerts}
          sub={quota.average == null ? '还没有额度数据' : `平均用量 ${Math.round(quota.average)}%`}
          icon={<Gauge className="h-5 w-5 text-warning" />}
          tone="hsl(var(--warning) / 0.15)"
          onClick={() => setPage('cockpit')}
        />
        <StatCard
          label="进行中任务"
          value={active}
          icon={<Activity className="h-5 w-5 text-warning" />}
          tone="hsl(var(--warning) / 0.15)"
        />
        <StatCard
          label="任务成败"
          value={`${success} / ${failed}`}
          sub="成功 / 失败"
          icon={
            failed > 0 ? (
              <XCircle className="h-5 w-5 text-destructive" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-success" />
            )
          }
          tone={failed > 0 ? 'hsl(var(--destructive) / 0.15)' : 'hsl(var(--success) / 0.15)'}
          onClick={() => setPage('automation')}
        />
      </div>

      <button
        onClick={() => setPage('security')}
        className="group w-full text-left"
        title="打开安全中心"
      >
        <Card className="transition-colors group-hover:border-primary/40">
          <CardContent className="flex items-center gap-5 p-5">
            <ScoreRing score={report?.score ?? 100} size={88} stroke={9} />
            <div className="flex-1">
              <div className="flex items-center gap-2 text-base font-semibold">
                <ShieldCheck className="h-5 w-5 text-primary" />
                安全概览
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {riskCount > 0
                  ? `发现 ${riskCount} 项可改进的安全风险，点击查看并一键修复。`
                  : '账号安全状况良好，未发现明显风险。'}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>弱密码 <span className="font-semibold text-foreground">{report?.totals.weakPassword ?? 0}</span></span>
                <span>密码重复 <span className="font-semibold text-foreground">{report?.totals.reusedPassword ?? 0}</span></span>
                <span>未开两步验证 <span className="font-semibold text-foreground">{report?.totals.no2fa ?? 0}</span></span>
                <span>无恢复信息 <span className="font-semibold text-foreground">{report?.totals.noRecovery ?? 0}</span></span>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </CardContent>
        </Card>
      </button>

      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Fingerprint className="h-5 w-5 text-primary" /> 环境隔离覆盖
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Coverage label="独立配置" value={total} total={total} hint="每个账号独立 Chrome 配置目录" />
            <Coverage label="独立代理" value={withProxy} total={total} hint="账号级出口 IP（不同网络环境）" />
            <Coverage label="浏览器身份" value={withIdentity} total={total} hint="UA / 语言 / 时区 + 指纹噪声" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">任务概览</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <Donut segments={taskSegments} centerLabel={tasks.length} centerSub="总任务" />
            <div className="flex-1">
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有任务记录。</p>
              ) : (
                <DonutLegend segments={taskSegments} />
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">近 14 天活动</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniBars data={activity} />
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>{activity[0]?.label}</span>
              <span>今天</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">平台分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {distribution.length === 0 && (
              <EmptyState
                icon={Users}
                title="还没有账号"
                description="去「账号管理」添加第一个账号，这里会显示按平台的分布。"
                className="py-8"
                action={
                  <Button size="sm" variant="outline" onClick={() => setPage('accounts')}>
                    去账号管理
                  </Button>
                }
              />
            )}
            {distribution.map((p) => (
              <div key={p.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <PlatformGlyph platform={p.key} size={22} />
                    {p.label}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{p.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(p.count / accounts.length) * 100}%`,
                      backgroundColor: p.color
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">最近任务</CardTitle>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setPage('automation')}
            >
              查看全部
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {recent.length === 0 && (
              <EmptyState
                icon={Bot}
                title="暂无任务记录"
                description="到「账号管理」选择账号运行自动化，任务会显示在这里。"
                className="py-8"
                action={
                  <Button size="sm" variant="outline" onClick={() => setPage('accounts')}>
                    去账号管理
                  </Button>
                }
              />
            )}
            {recent.map((t) => (
              <div key={t.id} className="flex items-center gap-3">
                <PlatformGlyph platform={t.platform} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {t.accountLabel} · {platformMeta(t.platform).label}
                  </div>
                  <div className="text-xs text-muted-foreground">{relativeTime(t.createdAt)}</div>
                </div>
                {t.status === 'running' && <Progress value={t.progress} className="w-24" />}
                <TaskStatusBadge status={t.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
