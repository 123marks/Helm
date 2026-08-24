import React from 'react'
import { Chrome, Cpu, Eye, EyeOff, Lock, LockKeyhole, Search, ShieldAlert } from 'lucide-react'
import { useAppStore, type Page } from '@renderer/store/app'
import { useLockStore } from '@renderer/store/lock'
import { usePrivacyStore } from '@renderer/store/privacy'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'

const TITLES: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: '仪表盘', subtitle: '账号与任务总览' },
  cockpit: { title: '额度总览', subtitle: '全平台订阅额度监控 · 告警 · 重置倒计时' },
  accounts: { title: '账号管理', subtitle: '增删改查 · 2FA · 凭据加密存储' },
  security: { title: '安全中心', subtitle: '弱密码 / 重复密码 / 2FA / 恢复信息体检' },
  '2fa': { title: '2FA 中心', subtitle: '实时验证码 · otpauth / Base32 导入 · 一键复制' },
  automation: { title: '自动化', subtitle: 'Playwright 驱动本地 Chrome · 并发任务' },
  providers: { title: '服务中心', subtitle: '邮箱 / 验证码 / 接码 / 代理 —— 注册与自动化的外部能力' },
  logs: { title: '日志', subtitle: '全链路结构化日志' },
  settings: { title: '设置', subtitle: '并发 / 浏览器 / 安全' }
}

export function TopBar(): React.JSX.Element {
  const { page, chrome, cryptoOk, settings } = useAppStore()
  const setCommandOpen = useAppStore((s) => s.setCommandOpen)
  const lockEnabled = useLockStore((s) => s.enabled)
  const lockNow = useLockStore((s) => s.lockNow)
  const revealed = usePrivacyStore((s) => s.revealed)
  const togglePrivacy = usePrivacyStore((s) => s.toggle)
  const t = TITLES[page]

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card/30 px-6">
      <div>
        <h1 className="text-lg font-semibold">{t.title}</h1>
        <p className="text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          title={revealed ? '隐藏敏感信息 (Ctrl+Shift+H)' : '显示敏感信息 (Ctrl+Shift+H)'}
          aria-label={revealed ? '隐藏敏感信息' : '显示敏感信息'}
          aria-pressed={revealed}
          onClick={togglePrivacy}
        >
          {revealed ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
        <button
          onClick={() => setCommandOpen(true)}
          className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="命令面板"
        >
          <Search className="h-3.5 w-3.5" />
          <span>搜索</span>
          <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
        </button>
        {lockEnabled && (
          <button
            onClick={() => lockNow()}
            className="flex items-center gap-1.5 rounded-lg border bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="立即锁定"
          >
            <LockKeyhole className="h-3.5 w-3.5" /> 锁定
          </button>
        )}
        {settings && (
          <Badge variant="secondary" className="gap-1">
            <Cpu className="h-3 w-3" /> 并发 {settings.maxConcurrency}
          </Badge>
        )}
        <Badge variant={cryptoOk ? 'success' : 'warning'} className="gap-1">
          {cryptoOk ? <Lock className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {cryptoOk ? '系统钥匙串' : '降级加密'}
        </Badge>
        <Badge variant={chrome?.found ? 'success' : 'destructive'} className="gap-1">
          <Chrome className="h-3 w-3" />
          {chrome?.found ? 'Chrome 已就绪' : '未检测到 Chrome'}
        </Badge>
      </div>
    </header>
  )
}
