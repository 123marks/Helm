import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Copy,
  CornerDownLeft,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Plug,
  ScrollText,
  Search,
  Settings,
  Shield,
  Users
} from 'lucide-react'
import { toast } from 'sonner'
import type { Page } from '@renderer/store/app'
import { api } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/app'
import { useAccountsStore } from '@renderer/store/accounts'
import { useLockStore } from '@renderer/store/lock'
import { platformMeta } from '@renderer/lib/platforms'
import { PlatformGlyph } from '@renderer/components/PlatformBadge'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'

const PAGES: { key: Page; label: string; icon: typeof Users }[] = [
  { key: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { key: 'cockpit', label: '额度总览', icon: Gauge },
  { key: 'accounts', label: '账号管理', icon: Users },
  { key: 'security', label: '安全中心', icon: Shield },
  { key: '2fa', label: '2FA 中心', icon: KeyRound },
  { key: 'automation', label: '自动化', icon: Bot },
  { key: 'providers', label: '服务中心', icon: Plug },
  { key: 'logs', label: '日志', icon: ScrollText },
  { key: 'settings', label: '设置', icon: Settings }
]

interface Item {
  id: string
  onEnter: () => void
  node: React.ReactNode
}

export function CommandPalette(): React.JSX.Element {
  const open = useAppStore((s) => s.commandOpen)
  const setOpen = useAppStore((s) => s.setCommandOpen)
  const setPage = useAppStore((s) => s.setPage)
  const openDetail = useAppStore((s) => s.openDetail)
  const accounts = useAccountsStore((s) => s.accounts)
  const lockEnabled = useLockStore((s) => s.enabled)
  const lockNow = useLockStore((s) => s.lockNow)

  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
    }
  }, [open])

  const query = q.trim().toLowerCase()

  const goPage = (key: Page): void => {
    setPage(key)
    setOpen(false)
  }
  const copyPassword = async (id: string): Promise<void> => {
    const s = await api.accounts.reveal(id)
    if (!s.password) {
      toast.error('该账号未设置密码')
      return
    }
    await navigator.clipboard.writeText(s.password)
    toast.success('密码已复制')
    setOpen(false)
  }
  const copyTotp = async (id: string): Promise<void> => {
    const r = await api.totp.get(id)
    if (!r) {
      toast.error('该账号未设置 2FA')
      return
    }
    await navigator.clipboard.writeText(r.code)
    toast.success('验证码已复制')
    setOpen(false)
  }
  const launchBrowser = async (id: string): Promise<void> => {
    const r = await api.automation.launchProfile(id)
    if (r.ok) toast.success(r.message)
    else toast.error(r.message)
    setOpen(false)
  }

  const items = useMemo<Item[]>(() => {
    const navItems: Item[] = PAGES.filter((p) => !query || p.label.toLowerCase().includes(query)).map(
      (p) => {
        const Icon = p.icon
        return {
          id: `nav:${p.key}`,
          onEnter: () => goPage(p.key),
          node: (
            <div className="flex items-center gap-3">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span>跳转 · {p.label}</span>
            </div>
          )
        }
      }
    )

    const matched = accounts
      .filter((a) => {
        if (!query) return true
        return (
          a.label.toLowerCase().includes(query) ||
          a.username.toLowerCase().includes(query) ||
          a.email.toLowerCase().includes(query) ||
          a.groupName.toLowerCase().includes(query) ||
          platformMeta(a.platform).label.toLowerCase().includes(query)
        )
      })
      .slice(0, 8)

    const acctItems: Item[] = matched.map((a) => ({
      id: `acct:${a.id}`,
      onEnter: () => {
        openDetail(a.id)
        setOpen(false)
      },
      node: (
        <div className="flex items-center gap-3">
          <PlatformGlyph platform={a.platform} size={26} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{a.label}</div>
            <div className="truncate text-xs text-muted-foreground">
              {a.email || a.username || platformMeta(a.platform).label}
            </div>
          </div>
          <button
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="打开浏览器"
            onClick={(e) => {
              e.stopPropagation()
              void launchBrowser(a.id)
            }}
          >
            <Globe className="h-4 w-4" />
          </button>
          <button
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="复制密码"
            onClick={(e) => {
              e.stopPropagation()
              void copyPassword(a.id)
            }}
          >
            <KeyRound className="h-4 w-4" />
          </button>
          {a.hasTotp && (
            <button
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="复制验证码"
              onClick={(e) => {
                e.stopPropagation()
                void copyTotp(a.id)
              }}
            >
              <Copy className="h-4 w-4" />
            </button>
          )}
        </div>
      )
    }))

    const cmdItems: Item[] = []
    if (lockEnabled && (!query || '锁定'.includes(query) || 'lock'.includes(query))) {
      cmdItems.push({
        id: 'cmd:lock',
        onEnter: () => {
          lockNow()
          setOpen(false)
        },
        node: (
          <div className="flex items-center gap-3">
            <LockKeyhole className="h-4 w-4 text-muted-foreground" />
            <span>锁定应用</span>
          </div>
        )
      })
    }

    return [...navItems, ...cmdItems, ...acctItems]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, query, lockEnabled])

  // Keep selection within bounds whenever the result set changes.
  useEffect(() => {
    setSel((s) => (items.length === 0 ? 0 : Math.min(s, items.length - 1)))
  }, [items.length])

  // Scroll the selected row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[sel]?.onEnter()
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索账号，或跳转页面…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">无匹配结果</div>
          )}
          {items.map((it, idx) => (
            <div
              key={it.id}
              data-idx={idx}
              onMouseEnter={() => setSel(idx)}
              onClick={() => it.onEnter()}
              className={`flex cursor-pointer items-center rounded-lg px-3 py-2 ${
                idx === sel ? 'bg-accent text-foreground' : 'text-foreground/90'
              }`}
            >
              <div className="min-w-0 flex-1">{it.node}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="h-3 w-3" /> 选择
          </span>
          <span>↑ ↓ 移动</span>
          <span>Esc 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
