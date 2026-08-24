import React, { useState } from 'react'
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { Account, QuotaMeter } from '@shared/types'
import {
  loginMethodLabel,
  meterPercent,
  meterWorthShowing,
  planDisplayName,
  planKindOf,
  planNote,
  planPanelFrame
} from '@shared/membership'
import { useAppStore } from '@renderer/store/app'

function barTone(p: number | null): string {
  if (p == null) return 'from-[#D4B896] via-[#E8D5B5] to-[#F3E6C4]'
  if (p >= 100) return 'from-red-500 to-rose-400'
  if (p >= 85) return 'from-amber-400 to-yellow-300'
  return 'from-[#C9A57A] via-[#E8D5B5] to-[#F6E8C8]'
}

function meterSummary(row: QuotaMeter): string {
  if (row.info) return row.note || '—'
  if (row.unlimited) return row.note ? `不限量 · ${row.note}` : '不限量'
  if (row.unit === '%') return `${Math.round(meterPercent(row) ?? 0)}%`
  if (row.limit != null) return `${row.used ?? 0} / ${row.limit}${row.unit ? ` ${row.unit}` : ''}`
  if (row.used != null) return `已用 ${row.used}${row.unit ? ` ${row.unit}` : ''}`
  return '已登录'
}

function MeterRow({
  row,
  showHint
}: {
  row: QuotaMeter
  showHint?: boolean
}): React.JSX.Element {
  const p = meterPercent(row)
  const summary = meterSummary(row)

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(
          [row.label, summary, row.note, row.hint].filter(Boolean).join(' · ')
        )
        toast.success(`已复制 ${row.label}`)
      }}
      className="group/meter relative mt-1.5 w-full rounded-md px-1 py-0.5 text-left transition-colors hover:bg-white/[0.06]"
      title={[row.hint, '点击复制'].filter(Boolean).join(' · ')}
    >
      <div className="flex h-4 items-center justify-between gap-2 text-[10px]">
        <span className="truncate text-muted-foreground">{row.label}</span>
        <span
          className={`shrink-0 tabular-nums ${p != null && p >= 100 ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {row.info ? summary : row.unlimited ? '不限量' : p != null ? `${Math.round(p)}%` : summary}
        </span>
      </div>
      {!row.info && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.08] shadow-[inset_0_1px_1px_rgba(0,0,0,0.35)]">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${barTone(p)}`}
            style={{ width: row.unlimited ? '100%' : `${p ?? 0}%` }}
          />
        </div>
      )}
      {!row.info && row.note && (
        <p className="mt-0.5 truncate text-[10px] leading-snug tabular-nums text-foreground/60">{row.note}</p>
      )}
      {showHint && row.hint && (
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground/75">{row.hint}</p>
      )}
      <span className="pointer-events-none absolute right-1 top-0.5 rounded bg-card/90 px-1 text-[10px] text-primary opacity-0 transition-opacity group-hover/meter:opacity-100">
        复制
      </span>
    </button>
  )
}

function FamilyCol({
  name,
  rows,
  showHint
}: {
  name: string
  rows: QuotaMeter[]
  showHint?: boolean
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-white/10 bg-black/15 px-1.5 pb-1.5 pt-1">
      <div className="px-1 text-[10px] font-semibold tracking-wide text-foreground/80">{name}</div>
      {rows.length ? (
        rows.map((row) => <MeterRow key={row.id} row={row} showHint={showHint} />)
      ) : (
        <p className="px-1 py-1 text-[10px] text-muted-foreground">暂无</p>
      )}
    </div>
  )
}

export function QuotaPanel({
  account,
  onRefresh,
  syncing,
  className
}: {
  account: Account
  onRefresh: () => void | Promise<void>
  syncing?: boolean
  className?: string
}): React.JSX.Element {
  const [spin, setSpin] = useState(false)
  const [showModels, setShowModels] = useState(false)
  const showHints = useAppStore((s) => s.settings?.showQuotaHints !== false)
  const q = account.quota
  const plan = q?.plan || ''
  const kind = planKindOf(account.platform, plan, q?.planKind)
  const title = plan ? planDisplayName(account.platform, plan, kind) : '订阅额度'
  const note = plan ? planNote(account.platform, plan) : ''

  const all: QuotaMeter[] = (q?.meters || []).filter(meterWorthShowing)
  const singlePool: QuotaMeter[] =
    q && (q.used != null || q.limit != null)
      ? [
          {
            id: 'included',
            label: '套餐额度',
            used: q.used,
            limit: q.limit,
            unit: q.unit,
            resetAt: q.resetAt
          }
        ].filter(meterWorthShowing)
      : []
  const rows: QuotaMeter[] = all.length > 0 ? all : singlePool
  const summary = rows.filter((r) => !r.detail)
  const models = rows.filter((r) => r.detail)
  const method = loginMethodLabel(q?.loginMethod, account.oauthProvider || account.customFields.provider)
  const reset = q?.resetAt ? new Date(q.resetAt) : null
  const days = reset ? Math.max(0, Math.ceil((reset.getTime() - Date.now()) / 86400000)) : null
  const claude = summary.filter((r) => r.group === 'claude')
  const gemini = summary.filter((r) => r.group === 'gemini')
  const rest = summary.filter((r) => r.group !== 'claude' && r.group !== 'gemini')
  const grouped = claude.length > 0 || gemini.length > 0

  const refresh = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setSpin(true)
    try {
      await onRefresh()
    } finally {
      setSpin(false)
    }
  }

  return (
    <div className={`${className ?? 'mt-3'} px-2.5 py-2.5 ${planPanelFrame(kind)}`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          title={[title, note].filter(Boolean).join(' · ') + '（点击复制套餐名）'}
          onClick={() => {
            void navigator.clipboard.writeText(title)
            toast.success('已复制套餐名')
          }}
        >
          <div className="truncate text-[13px] font-semibold leading-5">{title}</div>
          <div className="flex h-4 items-center gap-1.5 text-[10px] text-muted-foreground">
            {q?.surface && <span className="truncate">{q.surface}</span>}
            {reset && (
              <span className="truncate tabular-nums">
                重置 {reset.toLocaleDateString()}{' '}
                {reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {days != null ? `（${days} 天）` : ''}
              </span>
            )}
            {!q?.surface && !reset && method && <span className="truncate">{method}</span>}
          </div>
        </button>
        <button
          type="button"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          onClick={(e) => void refresh(e)}
          title="刷新额度（会请求官方接口）"
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : (
            <RefreshCw className={`h-3.5 w-3.5 ${spin ? 'animate-spin' : ''}`} />
          )}
        </button>
      </div>

      {showHints && note && (
        <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground/75">{note}</p>
      )}

      <div className="mt-0.5 flex-1">
        {q?.error ? (
          <p className="mt-1 text-[11px] text-warning">{q.error}</p>
        ) : syncing && rows.length === 0 ? (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> 正在同步额度…
          </p>
        ) : grouped ? (
          <>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <FamilyCol name="Claude" rows={claude} showHint={showHints} />
              <FamilyCol name="Gemini" rows={gemini} showHint={showHints} />
            </div>
            {rest.map((row) => (
              <MeterRow key={row.id} row={row} showHint={showHints} />
            ))}
          </>
        ) : summary.length > 0 ? (
          summary.map((row) => <MeterRow key={row.id} row={row} showHint={showHints} />)
        ) : plan ? (
          <p className="mt-1 text-[11px] text-muted-foreground">已登录，点刷新拉取用量</p>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">点右上角刷新，或先官方授权登录再查额度</p>
        )}
      </div>

      {models.length > 0 && (
        <div className="mt-2 border-t border-white/10 pt-1.5">
          <button
            type="button"
            onClick={() => setShowModels((v) => !v)}
            className="flex w-full items-center justify-between rounded-md px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <span>按模型额度（{models.length}）</span>
            <ChevronDown className={`h-3 w-3 transition-transform ${showModels ? 'rotate-180' : ''}`} />
          </button>
          {showModels && models.map((row) => <MeterRow key={row.id} row={row} />)}
        </div>
      )}
    </div>
  )
}
