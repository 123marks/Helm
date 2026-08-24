import React, { useEffect, useState } from 'react'
import {
  Bot,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Plug,
  ScrollText,
  Settings,
  Shield,
  Users
} from 'lucide-react'
import type { UpdateStatus } from '@shared/types'
import { useAppStore, type Page } from '@renderer/store/app'
import { api } from '@renderer/lib/api'
import { Logo } from '@renderer/components/Logo'
import { cn } from '@renderer/lib/utils'

const NAV: { key: Page; label: string; icon: typeof Users }[] = [
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

export function Sidebar(): React.JSX.Element {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    void api.updater.status().then(setUpdate)
    return api.updater.onChanged(setUpdate)
  }, [])

  const updateHint =
    update.state === 'downloaded'
      ? `有更新 v${update.version}`
      : update.state === 'downloading'
        ? '正在下载更新'
        : update.state === 'available'
          ? `发现 v${update.version}`
          : ''

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-card/40">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Logo size={38} className="rounded-[11px] shadow-sm" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Helm</div>
          <div className="text-[11px] text-muted-foreground">AI 订阅账号驾驶舱</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map((item) => {
          const Icon = item.icon
          const active = page === item.key
          return (
            <button
              key={item.key}
              onClick={() => setPage(item.key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="px-5 py-4 text-[11px] text-muted-foreground">
        <div>v{__APP_VERSION__} · MIT</div>
        <div className="mt-0.5">本地数据 · 加密存储</div>
        {updateHint && (
          <button
            type="button"
            onClick={() => setPage('settings')}
            className="mt-2 w-full rounded-md bg-primary/15 px-2 py-1 text-left text-[11px] font-medium text-primary hover:bg-primary/25"
          >
            {updateHint}
          </button>
        )}
      </div>
    </aside>
  )
}
