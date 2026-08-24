import React from 'react'
import { toast } from 'sonner'
import type { Account } from '@shared/types'
import { accountSubtitle } from '@shared/accountDisplay'
import { loginMethodShort } from '@shared/identity'
import { platformMeta } from '@renderer/lib/platforms'
import { usePrivacyStore } from '@renderer/store/privacy'

function purpose(a: Account): string {
  if (a.platform === 'google') return 'SSO 授权源 · 收信 / 恢复邮箱'
  if (a.platform === 'github') return 'OAuth 授权源 · 给 Cursor / Kiro 等登录'
  if (a.platform === 'microsoft') return 'Microsoft 身份 · SSO / Outlook'
  if (a.platform === 'apple') return 'Apple ID · 登录与隐藏邮箱'
  if (a.platform === 'x') return 'X 身份 · 登录与绑定'
  if (a.platform === 'discord') return 'Discord 身份'
  if (a.platform === 'youtube') return 'YouTube / Google 关联'
  if (a.platform === 'custom') return '自定义记录'
  return '身份账号'
}

function Row({
  label,
  value,
  copy,
  ok
}: {
  label: string
  value: string
  copy?: string
  ok?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={!copy}
      title={copy ? '点击复制' : undefined}
      onClick={() => {
        if (!copy) return
        void navigator.clipboard.writeText(copy)
        toast.success(`已复制${label}`)
      }}
      className="flex w-full items-baseline justify-between gap-3 rounded-md px-1 py-0.5 text-left hover:bg-white/6 disabled:cursor-default"
    >
      <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 truncate text-[11px] ${
          ok === false ? 'text-muted-foreground/70' : ok ? 'text-emerald-300' : 'text-foreground/90'
        }`}
      >
        {value}
      </span>
    </button>
  )
}

export function IdentityPanel({
  account,
  className
}: {
  account: Account
  className?: string
}): React.JSX.Element {
  const revealed = usePrivacyStore((s) => s.revealed)
  const a = account
  const meta = platformMeta(a.platform)
  const login =
    loginMethodShort(a.oauthProvider || a.customFields.provider) ||
    (a.hasPassword ? '账密' : a.hasRefreshToken ? 'Token' : '未配置登录')
  const recovery = a.recoveryEmail || a.recoveryPhone || ''

  return (
    <div className={`${className ?? 'mt-3'} identity-panel identity-panel-${a.platform} px-2.5 py-2.5`}>
      <div className="truncate text-[13px] font-semibold leading-5">{meta.label} · 身份账号</div>
      <div className="flex h-4 items-center truncate text-[10px] text-muted-foreground">{purpose(a)}</div>
      <div className="mt-2 flex-1 space-y-0.5">
        <Row label="账号" value={accountSubtitle(a, revealed) || '未填写'} copy={a.email || a.username} />
        <Row label="登录" value={login} />
        <Row label="2FA" value={a.hasTotp ? '已配置' : '未配置'} ok={a.hasTotp} />
        <Row
          label="恢复"
          value={recovery || '未设置'}
          copy={recovery || undefined}
          ok={!!recovery}
        />
      </div>
    </div>
  )
}
