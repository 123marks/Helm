import React from 'react'
import { Globe, Inbox, LogIn, Pencil, Play, Star, Trash2 } from 'lucide-react'
import type { Account } from '@shared/types'
import { planCardFrame, planKindOf } from '@shared/membership'
import { accountTitle, maskEmail } from '@shared/accountDisplay'
import { loginMethodShort, looksLikeEmail } from '@shared/identity'
import { hasLocalApply, hasQuota, localApplyLabel, platformMeta } from '@renderer/lib/platforms'
import { IdentityPanel } from '@renderer/components/IdentityPanel'
import { cn, relativeTime } from '@renderer/lib/utils'
import { PlatformGlyph } from '@renderer/components/PlatformBadge'
import { MembershipBadge } from '@renderer/components/MembershipBadge'
import { QuotaPanel } from '@renderer/components/QuotaMeters'
import { AccountStatusBadge } from '@renderer/components/status'
import { usePrivacyStore } from '@renderer/store/privacy'
import { Badge } from '@renderer/components/ui/badge'
import { Checkbox } from '@renderer/components/ui/checkbox'

function StatusDot({
  label,
  ok,
  title,
  onClick
}: {
  label: string
  ok: boolean
  title: string
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        'h-2 w-2 rounded-full transition-transform',
        ok ? 'bg-emerald-400 shadow-[0_0_7px] shadow-emerald-400/55' : 'bg-muted-foreground/30',
        onClick && 'hover:scale-125'
      )}
    />
  )
}

function ToolbarIcon({
  title,
  onClick,
  danger,
  accent,
  children
}: {
  title: string
  onClick: () => void
  danger?: boolean
  accent?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
        danger
          ? 'hover:bg-destructive/10 hover:text-destructive'
          : accent
            ? 'text-primary hover:bg-primary/15 hover:text-primary'
            : 'hover:bg-background hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

export interface AccountCardHandlers {
  selected: boolean
  current?: boolean
  onToggleSelect: () => void
  onOpenDetail: () => void
  onToggleFavorite: () => void
  onEdit: () => void
  onRun: () => void
  onApplyLocal: () => void
  onLaunch: () => void
  onAuthLogin: () => void
  onCopyPassword: () => void
  onCopyTotp: () => void
  onCopyRecovery: () => void
  onEditProxy: () => void
  onPeekMail: () => void
  onRefreshQuota: () => void | Promise<void>
  onDelete: () => void
}

export function AccountCard({
  account,
  selected,
  current = false,
  running = false,
  syncing = false,
  onToggleSelect,
  onOpenDetail,
  onToggleFavorite,
  onEdit,
  onRun,
  onApplyLocal,
  onLaunch,
  onAuthLogin,
  onCopyPassword,
  onCopyTotp,
  onCopyRecovery,
  onEditProxy,
  onPeekMail,
  onRefreshQuota,
  onDelete
}: {
  account: Account
  running?: boolean
  current?: boolean
  syncing?: boolean
} & AccountCardHandlers): React.JSX.Element {
  const a = account
  const revealed = usePrivacyStore((s) => s.revealed)
  const rawTitle = accountTitle(a)
  const title = looksLikeEmail(rawTitle) ? maskEmail(rawTitle, revealed) : rawTitle
  const method = loginMethodShort(a.oauthProvider || a.customFields.provider || a.quota?.loginMethod)
  const kind = planKindOf(a.platform, a.quota?.plan || '', a.quota?.planKind)
  const frame = running
    ? 'account-card-running'
    : current
      ? 'account-card-current'
      : a.favorite
        ? 'account-card-main'
        : hasQuota(a.platform)
          ? planCardFrame(kind)
          : 'border'
  const dots = [
    {
      label: '密码',
      ok: a.hasPassword,
      title: a.hasPassword ? '点击复制密码' : '未设置密码',
      onClick: a.hasPassword ? onCopyPassword : undefined
    },
    {
      label: '2FA',
      ok: a.hasTotp,
      title: a.hasTotp ? '点击复制验证码' : '未配置 2FA',
      onClick: a.hasTotp ? onCopyTotp : undefined
    },
    {
      label: '代理',
      ok: !!a.proxyUrl,
      title: a.proxyUrl ? '编辑代理' : '配置代理',
      onClick: onEditProxy
    },
    {
      label: '收信',
      ok: a.hasMailboxPass || a.hasRefreshToken,
      title: a.hasMailboxPass || a.hasRefreshToken ? '读取最近邮件' : '未配置收信凭证',
      onClick: onPeekMail
    },
    {
      label: '恢复',
      ok: !!a.recoveryEmail || !!a.recoveryPhone,
      title: a.recoveryEmail || a.recoveryPhone ? '点击复制恢复信息' : '未设置恢复信息',
      onClick: a.recoveryEmail || a.recoveryPhone ? onCopyRecovery : undefined
    }
  ]
  return (
    <div
      data-state={selected ? 'selected' : undefined}
      className={`${frame} group flex h-full flex-col rounded-xl bg-card p-4 data-[state=selected]:ring-2 data-[state=selected]:ring-primary/40`}
    >
      <div className="flex h-11 items-center gap-2.5">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="shrink-0" />
        <PlatformGlyph platform={a.platform} size={28} />
        <button className="min-w-0 flex-1 text-left" onClick={onOpenDetail} title="查看详情">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span className="truncate text-sm font-medium group-hover:text-primary">{title}</span>
            <AccountStatusBadge status={a.status} />
            {hasQuota(a.platform) && <MembershipBadge platform={a.platform} quota={a.quota} />}
            {current && (
              <Badge className="h-5 shrink-0 bg-emerald-500/20 px-1.5 text-[10px] text-emerald-300">
                当前
              </Badge>
            )}
            {running && <Badge className="h-5 shrink-0 px-1.5 text-[10px]">执行中</Badge>}
          </div>
          <div className="mt-0.5 flex h-5 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0">{platformMeta(a.platform).label}</span>
            {method && (
              <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                {method}
              </Badge>
            )}
            {a.groupName && (
              <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
                {a.groupName}
              </Badge>
            )}
            {a.tags.slice(0, 2).map((t) => (
              <Badge key={t} variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        </button>
        <button
          onClick={onToggleFavorite}
          title={a.favorite ? '取消主号' : '设为主号'}
          className="shrink-0 text-muted-foreground/40 transition-colors hover:text-warning"
        >
          <Star className={`h-4 w-4 ${a.favorite ? 'fill-warning text-warning' : ''}`} />
        </button>
      </div>

      {hasQuota(a.platform) ? (
        <QuotaPanel account={a} onRefresh={onRefreshQuota} syncing={syncing} className="mt-3 flex-1" />
      ) : (
        <IdentityPanel account={a} className="mt-3 flex-1" />
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2.5">
        <div className="flex items-center gap-1.5" title="绿点表示已配置，点击复制或打开">
          {dots.map((d) => (
            <StatusDot key={d.label} {...d} />
          ))}
        </div>
        <span className="min-w-0 truncate text-[11px] tabular-nums text-muted-foreground">
          {relativeTime(a.lastUsedAt)}
        </span>
        <div className="ml-auto flex h-8 items-center rounded-lg border border-border/80 bg-muted/40 p-0.5">
          {hasLocalApply(a.platform) ? (
            <ToolbarIcon
              accent
              title={`应用到本地 ${localApplyLabel(a.platform)}`}
              onClick={onApplyLocal}
            >
              <Play className="h-3.5 w-3.5" />
            </ToolbarIcon>
          ) : (
            <ToolbarIcon title="运行自动化" onClick={onRun}>
              <Play className="h-3.5 w-3.5" />
            </ToolbarIcon>
          )}
          <ToolbarIcon title="官方授权登录" onClick={onAuthLogin}>
            <LogIn className="h-3.5 w-3.5" />
          </ToolbarIcon>
          <ToolbarIcon title="打开浏览器" onClick={onLaunch}>
            <Globe className="h-3.5 w-3.5" />
          </ToolbarIcon>
          <ToolbarIcon title="读取最近邮件" onClick={onPeekMail}>
            <Inbox className="h-3.5 w-3.5" />
          </ToolbarIcon>
          <ToolbarIcon title="编辑" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </ToolbarIcon>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <ToolbarIcon title="删除" danger onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </ToolbarIcon>
        </div>
      </div>
    </div>
  )
}
