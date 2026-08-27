import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ChevronDown,
  Download,
  FileUp,
  Inbox,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  UserPlus,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type { OutlookPoolItem, OutlookPoolStats, OutlookPoolStatus } from '@shared/types'
import { api } from '@renderer/lib/api'
import { relativeTime } from '@renderer/lib/utils'
import { usePrivacyStore } from '@renderer/store/privacy'
import { maskEmail } from '@shared/accountDisplay'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Textarea } from '@renderer/components/ui/textarea'
import { Checkbox } from '@renderer/components/ui/checkbox'

const STATUS_META: Record<OutlookPoolStatus, { label: string; pill: string; bar: string; text: string }> = {
  active: {
    label: '有效',
    pill: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    bar: 'bg-emerald-400',
    text: 'text-emerald-300'
  },
  unchecked: {
    label: '待检',
    pill: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    bar: 'bg-sky-400',
    text: 'text-sky-300'
  },
  cooldown: {
    label: '待重试',
    pill: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bar: 'bg-amber-400',
    text: 'text-amber-300'
  },
  in_use: {
    label: '使用中',
    pill: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    bar: 'bg-indigo-400',
    text: 'text-indigo-300'
  },
  dead: {
    label: '死号',
    pill: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    bar: 'bg-rose-400',
    text: 'text-rose-300'
  }
}

const BAR_ORDER: OutlookPoolStatus[] = ['active', 'unchecked', 'in_use', 'cooldown', 'dead']

function HealthBar({ stats }: { stats: OutlookPoolStats }): React.JSX.Element {
  const all: { key: OutlookPoolStatus; value: number }[] = [
    { key: 'active', value: stats.active },
    { key: 'unchecked', value: stats.unchecked },
    { key: 'in_use', value: stats.inUse },
    { key: 'cooldown', value: stats.cooldown },
    { key: 'dead', value: stats.dead }
  ]
  const segments = all.filter((s) => s.value > 0)
  const total = stats.total || 1
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className="flex h-full w-full">
        {segments.map((s) => (
          <div
            key={s.key}
            className={STATUS_META[s.key].bar}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${STATUS_META[s.key].label} ${s.value}`}
          />
        ))}
      </div>
    </div>
  )
}

export function OutlookPoolPanel(): React.JSX.Element {
  const revealed = usePrivacyStore((s) => s.revealed)
  const [items, setItems] = useState<OutlookPoolItem[]>([])
  const [stats, setStats] = useState<OutlookPoolStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [claimCount, setClaimCount] = useState(1)
  const [collapsed, setCollapsed] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [list, s] = await Promise.all([api.outlookPool.list(), api.outlookPool.stats()])
      setItems(list)
      setStats(s)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const doImport = async (): Promise<void> => {
    if (!importText.trim()) return
    setBusy(true)
    try {
      const r = await api.outlookPool.import(importText)
      const parts = [`导入 ${r.imported} 个`]
      if (r.skipped) parts.push(`跳过重复 ${r.skipped}`)
      if (r.errors.length) parts.push(`${r.errors.length} 行解析失败`)
      toast.success(parts.join('，'))
      if (r.errors.length) toast.error(r.errors.slice(0, 3).join('；'))
      setImportText('')
      setImportOpen(false)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const testOne = async (id: string): Promise<void> => {
    setTestingId(id)
    try {
      const r = await api.outlookPool.test(id)
      if (r.ok) toast.success(r.message)
      else toast.error(r.message)
      await load()
    } finally {
      setTestingId(null)
    }
  }

  const keepaliveAll = async (): Promise<void> => {
    setBusy(true)
    toast.loading('正在批量保活…', { id: 'ol-keepalive' })
    try {
      const r = await api.outlookPool.keepalive()
      toast.success(`保活完成：检查 ${r.checked}，有效 ${r.alive}，失效 ${r.dead}`, { id: 'ol-keepalive' })
      await load()
    } catch (e) {
      toast.error((e as Error).message, { id: 'ol-keepalive' })
    } finally {
      setBusy(false)
    }
  }

  const exportPool = async (sixSegment: boolean): Promise<void> => {
    const ids = selected.size ? [...selected] : undefined
    const text = await api.outlookPool.export(ids, sixSegment)
    if (!text.trim()) {
      toast.error('没有可导出的账号')
      return
    }
    const saved = await api.system.saveFile(`outlook-pool-${sixSegment ? '6seg' : '4seg'}-${Date.now()}.txt`, text)
    if (saved) toast.success('已导出 combo')
  }

  const claim = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.outlookPool.claim(claimCount)
      if (r.created === 0) toast.error('池里没有可用的有效号了')
      else toast.success(`已取 ${r.created} 个号建到账号库（微软）`)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const purgeDead = async (): Promise<void> => {
    if (!window.confirm('确认清理所有死号？此操作不可撤销。')) return
    const r = await api.outlookPool.purgeDead()
    toast.success(`已清理 ${r.removed} 个死号`)
    await load()
  }

  const removeSelected = async (): Promise<void> => {
    if (selected.size === 0) return
    const r = await api.outlookPool.remove([...selected])
    toast.success(`已删除 ${r.removed} 个`)
    setSelected(new Set())
    await load()
  }

  const toggle = (id: string): void =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allChecked = items.length > 0 && items.every((i) => selected.has(i.id))
  const legend = useMemo(() => (stats ? BAR_ORDER.filter((k) => statValue(stats, k) > 0) : []), [stats])

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {/* Header */}
        <div className="border-b bg-gradient-to-br from-primary/[0.07] to-transparent px-4 py-3.5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
              <Inbox className="h-5 w-5 text-primary" />
            </div>
            <div className="mr-auto min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Outlook 邮箱池</span>
                {stats && (
                  <Badge variant="outline" className="h-5 tabular-nums">
                    {stats.total}
                  </Badge>
                )}
                <button
                  type="button"
                  onClick={() => setCollapsed((v) => !v)}
                  className="text-muted-foreground transition-transform hover:text-foreground"
                  title={collapsed ? '展开' : '收起'}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                </button>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                导入现成微软号（<span className="font-mono">email----password----clientId----refreshToken</span>
                ，可选 + 恢复邮箱两段）。当收信池用，也能一键取现成号建账。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setImportOpen((v) => !v)}>
                <FileUp className="h-4 w-4" /> 导入
              </Button>
              <div className="flex items-center overflow-hidden rounded-lg border bg-card/60">
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={claimCount}
                  onChange={(e) => setClaimCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                  className="h-8 w-12 bg-transparent px-2 text-center text-sm tabular-nums outline-none"
                  title="取号数量"
                />
                <span className="h-4 w-px bg-border" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-none"
                  disabled={busy}
                  onClick={() => void claim()}
                  title="从池里取现成号，直接建到微软账号库"
                >
                  <UserPlus className="h-4 w-4" /> 取号建账
                </Button>
              </div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void keepaliveAll()}>
                <Activity className={`h-4 w-4 ${busy ? 'animate-pulse' : ''}`} /> 批量保活
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void load()} title="刷新列表">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Health composition */}
          {stats && stats.total > 0 && (
            <div className="mt-3 space-y-1.5">
              <HealthBar stats={stats} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                {legend.map((k) => (
                  <span key={k} className="flex items-center gap-1.5 text-muted-foreground">
                    <span className={`h-2 w-2 rounded-full ${STATUS_META[k].bar}`} />
                    {STATUS_META[k].label}
                    <span className={`tabular-nums ${STATUS_META[k].text}`}>{statValue(stats, k)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="space-y-3 p-4">
            {importOpen && (
              <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <Textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={'name@outlook.com----password----xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx----M.C519_BAY.0.U.-…\n每行一个，支持四段 / 六段（+ 恢复邮箱----恢复密码）'}
                  className="min-h-[120px] font-mono text-xs"
                  rows={6}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)}>
                    取消
                  </Button>
                  <Button size="sm" disabled={busy || !importText.trim()} onClick={() => void doImport()}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} 导入到池
                  </Button>
                </div>
              </div>
            )}

            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  已选 <span className="font-semibold text-foreground">{selected.size}</span> 个
                </span>
                <span className="mx-1 h-4 w-px bg-border" />
                <Button size="sm" variant="outline" onClick={() => void exportPool(false)}>
                  <Download className="h-4 w-4" /> 导出四段
                </Button>
                <Button size="sm" variant="outline" onClick={() => void exportPool(true)}>
                  <Download className="h-4 w-4" /> 导出六段
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void removeSelected()}>
                  <Trash2 className="h-4 w-4" /> 删除所选
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  清除
                </Button>
              </div>
            )}

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  池是空的。点右上「导入」粘贴现成 Outlook 号，或用注册流程产出后回填。
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <div className="grid grid-cols-[28px_minmax(0,2fr)_76px_60px_minmax(0,1.4fr)_104px_84px] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={() => setSelected(allChecked ? new Set() : new Set(items.map((i) => i.id)))}
                  />
                  <span>邮箱</span>
                  <span>状态</span>
                  <span className="text-right">用量</span>
                  <span>最近结果</span>
                  <span className="text-right">最近检查</span>
                  <span className="text-right">操作</span>
                </div>
                <div className="max-h-[440px] divide-y divide-border/50 overflow-y-auto">
                  {items.map((it) => {
                    const meta = STATUS_META[it.status]
                    return (
                      <div
                        key={it.id}
                        data-state={selected.has(it.id) ? 'selected' : undefined}
                        className="grid grid-cols-[28px_minmax(0,2fr)_76px_60px_minmax(0,1.4fr)_104px_84px] items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent/40 data-[state=selected]:bg-primary/[0.06]"
                      >
                        <Checkbox checked={selected.has(it.id)} onCheckedChange={() => toggle(it.id)} />
                        <div className="min-w-0">
                          <div className="truncate">{maskEmail(it.email, revealed)}</div>
                          {(it.recoveryEmail || it.tags.length > 0) && (
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              {it.recoveryEmail && <span className="truncate">恢复 {maskEmail(it.recoveryEmail, revealed)}</span>}
                              {it.tags.map((t) => (
                                <Badge key={t} variant="outline" className="h-4 px-1 text-[9px]">
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className={`inline-flex h-5 w-fit items-center rounded-full border px-1.5 text-[10px] ${meta.pill}`}>
                          {meta.label}
                        </span>
                        <span className="text-right text-xs tabular-nums text-muted-foreground">{it.usedCount}</span>
                        <span className="truncate text-[11px] text-muted-foreground" title={it.lastResult}>
                          {it.lastResult || '—'}
                        </span>
                        <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                          {it.lastCheckAt ? relativeTime(it.lastCheckAt) : '从未'}
                        </span>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="测活（刷新令牌）"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                            onClick={() => void testOne(it.id)}
                          >
                            {testingId === it.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                            ) : (
                              <Activity className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            title="删除"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              void (async () => {
                                await api.outlookPool.remove([it.id])
                                await load()
                              })()
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {stats && stats.dead > 0 && (
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void purgeDead()}>
                  <Trash2 className="h-4 w-4" /> 清理 {stats.dead} 个死号
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function statValue(stats: OutlookPoolStats, key: OutlookPoolStatus): number {
  if (key === 'active') return stats.active
  if (key === 'unchecked') return stats.unchecked
  if (key === 'cooldown') return stats.cooldown
  if (key === 'in_use') return stats.inUse
  return stats.dead
}
