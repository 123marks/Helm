import React, { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'

export function copyValue(text: string | null | undefined, label: string): boolean {
  if (!text) {
    toast.error(`没有可复制的${label}`)
    return false
  }
  void navigator.clipboard.writeText(text)
  toast.success(`已复制${label}`)
  return true
}

export function CopyableValue({
  label,
  text,
  children,
  secret = false,
  align = 'right',
  mono = true,
  className
}: {
  label: string
  text?: string | null
  children?: React.ReactNode
  secret?: boolean
  align?: 'left' | 'right'
  mono?: boolean
  className?: string
}): React.JSX.Element {
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  const empty = !text

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(id)
  }, [copied])

  if (empty && children == null) {
    return <span className="text-muted-foreground">—</span>
  }

  const masked = Boolean(secret && text && !show)
  const body = children ?? (masked ? '••••••••••••••••' : text)

  return (
    <div className={cn('group/copy relative min-w-0 max-w-full flex-1', className)}>
      <button
        type="button"
        disabled={empty}
        onClick={() => {
          if (copyValue(text, label)) setCopied(true)
        }}
        title={empty ? undefined : `点击复制${label}`}
        className={cn(
          'w-full max-h-32 overflow-auto break-all rounded-md px-1.5 py-1 text-[11px] leading-relaxed transition-colors',
          align === 'right' ? 'pr-14 text-right' : 'pl-14 text-left',
          mono && 'font-mono',
          empty
            ? 'cursor-default font-sans text-muted-foreground'
            : 'cursor-pointer hover:bg-primary/10 hover:text-foreground'
        )}
      >
        {empty ? '—' : body}
      </button>
      {!empty && (
        <div
          className={cn(
            'pointer-events-none absolute top-0.5 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/copy:opacity-100 group-focus-within/copy:opacity-100',
            align === 'right' ? 'right-1' : 'left-1'
          )}
        >
          {secret && (
            <button
              type="button"
              className="pointer-events-auto rounded bg-card/95 p-0.5 text-muted-foreground shadow-sm hover:text-foreground"
              title={show ? '隐藏' : '显示'}
              onClick={(e) => {
                e.stopPropagation()
                setShow((v) => !v)
              }}
            >
              {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          )}
          <span
            className={cn(
              'rounded bg-card/95 px-1.5 py-0.5 text-[10px] font-sans shadow-sm',
              copied ? 'text-emerald-400' : 'text-primary'
            )}
          >
            {copied ? '已复制' : '点击复制'}
          </span>
        </div>
      )}
    </div>
  )
}
