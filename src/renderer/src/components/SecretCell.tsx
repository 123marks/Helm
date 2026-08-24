import React, { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { usePrivacyStore } from '@renderer/store/privacy'
import { Input } from '@renderer/components/ui/input'

function maskPartial(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@')
    const head = local.slice(0, 2)
    return `${head}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`
  }
  if (value.length <= 4) return '••••'
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

export function SecretCell({
  value,
  empty = '—',
  mask = 'dots',
  copyLabel,
  onEdit,
  load,
  className
}: {
  value: string | null
  empty?: string
  mask?: 'dots' | 'partial'
  copyLabel: string
  onEdit?: (next: string) => Promise<void>
  load?: () => Promise<string | null>
  className?: string
}): React.JSX.Element {
  const revealed = usePrivacyStore((s) => s.revealed)
  const [plain, setPlain] = useState<string | null>(value)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setPlain(value)
  }, [value])

  const loadRef = React.useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!revealed || !loadRef.current) return
    let live = true
    void loadRef.current().then((v) => {
      if (live) setPlain(v)
    })
    return () => {
      live = false
    }
  }, [revealed])

  const resolve = async (): Promise<string | null> => {
    if (plain) return plain
    if (load) {
      const v = await load()
      setPlain(v)
      return v
    }
    return value
  }

  const copy = async (): Promise<void> => {
    const v = await resolve()
    if (!v) {
      toast.error(`没有可复制的${copyLabel.replace('已复制', '')}`)
      return
    }
    await navigator.clipboard.writeText(v)
    toast.success(copyLabel)
  }

  const display = revealed
    ? (plain || empty)
    : mask === 'partial' && (plain || value)
      ? maskPartial(plain || value || '')
      : load || plain || value
        ? '••••••••'
        : empty

  if (editing) {
    return (
      <Input
        autoFocus
        className="h-7 font-mono text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            void onEdit?.(draft).then(() => {
              setPlain(draft)
              setEditing(false)
              toast.success('已保存')
            })
          }
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={() => {
          void onEdit?.(draft).then(() => {
            setPlain(draft)
            setEditing(false)
          })
        }}
      />
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => void copy()}
        title="点击复制"
        className="group/copy max-w-[180px] truncate rounded-md px-1 py-0.5 font-mono text-xs tracking-wide text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
      >
        {display}
        <span className="ml-1 font-sans text-[10px] text-primary opacity-0 transition-opacity group-hover/copy:opacity-100">
          复制
        </span>
      </button>
      {onEdit && (
        <button
          type="button"
          title={revealed ? '编辑' : '请先开启显示再编辑'}
          className="text-muted-foreground/50 hover:text-foreground"
          onClick={() => {
            if (!revealed) {
              toast.error('请先点击顶栏小眼睛显示敏感信息')
              return
            }
            setDraft(plain ?? '')
            setEditing(true)
          }}
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}
