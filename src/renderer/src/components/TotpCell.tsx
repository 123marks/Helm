import React, { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { TotpResult } from '@shared/types'
import { api } from '@renderer/lib/api'
import { usePrivacyStore } from '@renderer/store/privacy'

export function TotpCell({
  accountId,
  hasTotp,
  onEditSecret
}: {
  accountId: string
  hasTotp: boolean
  onEditSecret?: () => void
}): React.JSX.Element {
  const revealed = usePrivacyStore((s) => s.revealed)
  const [data, setData] = useState<TotpResult | null>(null)

  useEffect(() => {
    if (!hasTotp) return
    let active = true
    const tick = async (): Promise<void> => {
      const r = await api.totp.get(accountId)
      if (active) setData(r)
    }
    void tick()
    const id = window.setInterval(tick, 1000)
    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [accountId, hasTotp])

  if (!hasTotp) return <span className="text-xs text-muted-foreground">未设置</span>
  if (!data) return <span className="text-xs text-muted-foreground">…</span>

  const frac = data.remainingSeconds / data.period
  const R = 9
  const C = 2 * Math.PI * R
  const danger = data.remainingSeconds <= 5

  return (
    <span className="inline-flex items-center gap-1">
      <button
        title="点击复制验证码"
        aria-label="复制当前验证码"
        onClick={() => {
          void navigator.clipboard.writeText(data.code)
          toast.success('验证码已复制')
        }}
        className="group inline-flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0 -rotate-90">
          <circle cx="11" cy="11" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="2.5" />
          <circle
            cx="11"
            cy="11"
            r={R}
            fill="none"
            stroke={danger ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <span className="font-mono text-sm font-semibold tracking-widest tabular-nums">
          {revealed ? (
            <>
              {data.code.slice(0, 3)}&nbsp;{data.code.slice(3)}
            </>
          ) : (
            '••• •••'
          )}
        </span>
        <span className="w-4 text-right text-[11px] tabular-nums text-muted-foreground">
          {data.remainingSeconds}
        </span>
        <span className="text-[10px] text-primary opacity-0 transition-opacity group-hover:opacity-100">复制</span>
      </button>
      {onEditSecret && (
        <button type="button" title="编辑 2FA 密钥" onClick={onEditSecret} className="text-muted-foreground/50">
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}
