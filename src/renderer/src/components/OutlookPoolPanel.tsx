import React, { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Download,
  FileUp,
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

const STATUS_TONE: Record<OutlookPoolStatus, { label: string; cls: string }> = {
  active: { label: '有效', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  unchecked: { label: '待检', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  cooldown: { label: '待重试', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  in_use: { label: '使用中', cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  dead: { label: '死号', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' }
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
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

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <div className="text-sm font-semibold">Outlook 邮箱池</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              导入现成微软号（<span className="font-mono">email----password----clientId----refreshToken</span>，可选 +
              恢复邮箱两段）。用作收信池，也能在批量注册时「取一个现成号」。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setImportOpen((v) => !v)}>
            <FileUp className="h-4 w-4" /> 导入
          </Button>
          <div className="flex items-center rounded-lg border bg-card/60">
            <input
              type="number"
              min={1}
              max={200}
              value={claimCount}
              onChange={(e) => setClaimCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              className="h-8 w-14 bg-transparent px-2 text-center text-sm tabular-nums outline-none"
              title="取号数量"
            />
            <Button
              size="sm"
              variant="ghost"
              className="rounded-l-none"
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

        {stats && (
          <div className="flex flex-wrap gap-2">
            <StatChip label="总数" value={stats.total} tone="" />
            <StatChip label="有效" value={stats.active} tone="text-emerald-300" />
            <StatChip label="待检" value={stats.unchecked} tone="text-sky-300" />
            <StatChip label="待重试" value={stats.cooldown} tone="text-amber-300" />
            <StatChip label="使用中" value={stats.inUse} tone="text-indigo-300" />
            <StatChip label="死号" value={stats.dead} tone="text-rose-300" />
          </div>
        )}

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
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
            <span>已选 {selected.size} 个</span>
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
              清除选择
            </Button>
          </div>
        )}

        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            池是空的。点「导入」粘贴现成 Outlook 号，或用注册流程产出后回填。
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[28px_minmax(0,2fr)_72px_64px_minmax(0,1.4fr)_112px_88px] items-center gap-2 border-b bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
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
            <div className="max-h-[420px] divide-y divide-border/60 overflow-y-auto">
              {items.map((it) => {
                const tone = STATUS_TONE[it.status]
                return (
                  <div
                    key={it.id}
                    className="grid grid-cols-[28px_minmax(0,2fr)_72px_64px_minmax(0,1.4fr)_112px_88px] items-center gap-2 px-3 py-2 text-sm"
                  >
                    <Checkbox checked={selected.has(it.id)} onCheckedChange={() => toggle(it.id)} />
                    <div className="min-w-0">
                      <div className="truncate">{maskEmail(it.email, revealed)}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {it.recoveryEmail && <span>恢复 {maskEmail(it.recoveryEmail, revealed)}</span>}
                        {it.tags.map((t) => (
                          <Badge key={t} variant="outline" className="h-4 px-1 text-[9px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <span className={`inline-flex h-5 w-fit items-center rounded-full border px-1.5 text-[10px] ${tone.cls}`}>
                      {tone.label}
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
      </CardContent>
    </Card>
  )
}
