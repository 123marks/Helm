import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Cookie,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  Inbox,
  Mail,
  History,
  Pencil,
  Play,
  QrCode,
  RotateCcw,
  Star,
  Trash2,
  Wifi
} from 'lucide-react'
import { toast } from 'sonner'
import type { Account, AccountSecrets, PasswordHistoryEntry } from '@shared/types'
import { accountTitle } from '@shared/accountDisplay'
import { mailboxKindLabel } from '@shared/mailboxAccount'
import { estimatePasswordStrength, strengthLabel } from '@shared/security'
import { api } from '@renderer/lib/api'
import { formatTime, relativeTime } from '@renderer/lib/utils'
import { hasLocalApply, hasQuota, localApplyLabel, platformMeta } from '@renderer/lib/platforms'
import { IdentityPanel } from '@renderer/components/IdentityPanel'
import { CopyableValue, copyValue } from '@renderer/components/CopyableValue'
import { MembershipBadge } from '@renderer/components/MembershipBadge'
import { QuotaPanel } from '@renderer/components/QuotaMeters'
import { useAppStore } from '@renderer/store/app'
import { useAccountsStore } from '@renderer/store/accounts'
import { PlatformGlyph } from '@renderer/components/PlatformBadge'
import { AccountStatusBadge } from '@renderer/components/status'
import { TotpCell } from '@renderer/components/TotpCell'
import { TotpQR } from '@renderer/components/TotpQR'
import { AccountDialog } from '@renderer/components/AccountDialog'
import { RunAutomationDialog } from '@renderer/components/RunAutomationDialog'
import { CloneAccountDialog } from '@renderer/components/CloneAccountDialog'
import { MailPeekDialog } from '@renderer/components/MailPeekDialog'
import { Sheet, SheetContent, SheetTitle } from '@renderer/components/ui/sheet'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { SkeletonRows } from '@renderer/components/ui/skeleton'

function Field({
  label,
  value,
  copyText,
  secret,
  copyable = true
}: {
  label: string
  value?: React.ReactNode
  copyText?: string
  secret?: boolean
  copyable?: boolean
}): React.JSX.Element {
  const raw = copyText ?? (typeof value === 'string' ? value : '')
  const empty = (value == null || value === '') && !raw
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 pt-1 text-muted-foreground">{label}</span>
      {empty ? (
        <span className="text-muted-foreground">—</span>
      ) : copyable && raw ? (
        <CopyableValue label={label} text={raw} secret={secret}>
          {typeof value !== 'string' && value != null ? value : undefined}
        </CopyableValue>
      ) : (
        <div className="min-w-0 max-w-full break-all text-right text-[11px] leading-relaxed text-foreground/80">
          {value ?? raw}
        </div>
      )}
    </div>
  )
}

function copy(text: string | null | undefined, label: string): void {
  copyValue(text, label)
}

function DrawerAction({
  icon: Icon,
  label,
  onClick,
  primary,
  danger,
  title
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  primary?: boolean
  danger?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <Button
      size="sm"
      variant={primary ? 'default' : 'outline'}
      title={title}
      onClick={onClick}
      className={`h-9 w-full justify-center px-2 text-xs ${
        danger ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : ''
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>
}

export function AccountDetailDrawer(): React.JSX.Element {
  const detailAccountId = useAppStore((s) => s.detailAccountId)
  const closeDetail = useAppStore((s) => s.closeDetail)
  const accounts = useAccountsStore((s) => s.accounts)
  const remove = useAccountsStore((s) => s.remove)
  const restore = useAccountsStore((s) => s.restore)
  const reloadAccounts = useAccountsStore((s) => s.load)
  const update = useAccountsStore((s) => s.update)
  const replace = useAccountsStore((s) => s.replace)

  const account = accounts.find((a) => a.id === detailAccountId) ?? null

  const [secrets, setSecrets] = useState<AccountSecrets | null>(null)
  const [revealPw, setRevealPw] = useState(false)
  const [revealCodes, setRevealCodes] = useState(false)
  const [revealToken, setRevealToken] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [editing, setEditing] = useState(false)
  const [running, setRunning] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [mailOpen, setMailOpen] = useState(false)
  const [history, setHistory] = useState<PasswordHistoryEntry[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [proxyProbe, setProxyProbe] = useState<{ loading: boolean; ok: boolean; text: string } | null>(null)

  const accountId = account?.id ?? null

  const reveal = useCallback(async (): Promise<void> => {
    if (!accountId) return
    try {
      setSecrets(await api.accounts.reveal(accountId))
    } catch {
      setSecrets(null)
    }
  }, [accountId])

  useEffect(() => {
    setSecrets(null)
    setRevealPw(false)
    setRevealCodes(false)
    setRevealToken(false)
    setShowQr(false)
    setHistory(null)
    setShowHistory(false)
    setProxyProbe(null)
    void reveal()
  }, [accountId, reveal])

  const testProxy = async (): Promise<void> => {
    if (!accountId) return
    setProxyProbe({ loading: true, ok: false, text: '测试中…' })
    const r = await api.automation.checkProxy(accountId)
    setProxyProbe({ loading: false, ok: r.ok, text: r.message })
  }

  const cookieRef = useRef<HTMLInputElement>(null)
  const exportCookies = async (): Promise<void> => {
    if (!account) return
    try {
      const json = await api.automation.exportCookies(account.id)
      const path = await api.system.saveFile(`cookies-${account.label}-${Date.now()}.json`, json)
      if (path) toast.success('已导出 Cookie 到 ' + path)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const onCookieFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !account) return
    try {
      const { imported } = await api.automation.importCookies(account.id, await f.text())
      toast.success(`已导入 ${imported} 条 Cookie`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const loadHistory = useCallback(async (): Promise<void> => {
    if (!accountId) return
    setHistory(await api.accounts.passwordHistory(accountId))
  }, [accountId])

  const toggleHistory = (): void => {
    const next = !showHistory
    setShowHistory(next)
    if (next && history === null) void loadHistory()
  }

  const copyHistory = async (id: number): Promise<void> => {
    copy(await api.accounts.revealPasswordHistory(id), '历史密码')
  }

  const restoreHistory = async (id: number): Promise<void> => {
    if (!accountId) return
    if (!window.confirm('确认把该账号的密码恢复为这条历史密码？当前密码会被存入历史。')) return
    await api.accounts.restorePassword(accountId, id)
    toast.success('已恢复为该历史密码')
    await Promise.all([reveal(), reloadAccounts(), loadHistory()])
  }

  // If the account was deleted elsewhere while the drawer points at it, close.
  useEffect(() => {
    if (detailAccountId && !account) closeDetail()
  }, [detailAccountId, account, closeDetail])

  const onDelete = async (): Promise<void> => {
    if (!account) return
    const id = account.id
    const label = account.label
    await remove(id)
    closeDetail()
    toast(`已将「${label}」移至回收站`, {
      action: { label: '撤销', onClick: () => void restore(id) }
    })
  }

  const launchBrowser = async (): Promise<void> => {
    if (!account) return
    const r = await api.automation.launchProfile(account.id)
    if (r.ok) toast.success(r.message)
    else toast.error(r.message)
  }

  const applyLocal = async (): Promise<void> => {
    if (!account) return
    try {
      const r = await api.automation.applyLocal(account.id)
      if (r.ok) toast.success(r.message)
      else toast.error(r.message)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const strength = secrets?.password ? estimatePasswordStrength(secrets.password) : -1
  const sLabel = strength >= 0 ? strengthLabel(strength) : null
  const open = !!account
  const blockClose = editing || running || cloning

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && closeDetail()}>
        {account && (
          <SheetContent
            onInteractOutside={(e) => blockClose && e.preventDefault()}
            onEscapeKeyDown={(e) => blockClose && e.preventDefault()}
          >
            <div className="flex items-center gap-3 border-b p-5 pr-12">
              <PlatformGlyph platform={account.platform} size={40} />
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base font-semibold">{accountTitle(account)}</SheetTitle>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  {platformMeta(account.platform).label}
                  <AccountStatusBadge status={account.status} />
                  {hasQuota(account.platform) && (
                    <MembershipBadge platform={account.platform} quota={account.quota} />
                  )}
                </div>
              </div>
              <button
                onClick={() => void update(account.id, { favorite: !account.favorite })}
                title={account.favorite ? '取消收藏' : '收藏'}
                className="shrink-0 text-muted-foreground/50 transition-colors hover:text-warning"
              >
                <Star className={`h-5 w-5 ${account.favorite ? 'fill-warning text-warning' : ''}`} />
              </button>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-5 pt-2">
                {hasQuota(account.platform) ? (
                  <QuotaPanel
                    account={account}
                    onRefresh={async () => {
                      const next = await api.automation.refreshQuota(account.id)
                      replace(next)
                      if (next.quota?.error) toast.error(next.quota.error)
                      else toast.success(next.quota?.plan ? `额度：${next.quota.plan}` : '额度已刷新')
                    }}
                  />
                ) : (
                  <IdentityPanel account={account} />
                )}

                <SectionTitle>账号信息</SectionTitle>
                <div className="divide-y">
                  <Field label="用户名" value={account.username} copyText={account.username} />
                  <Field label="邮箱" value={account.email} copyText={account.email} />
                  <Field
                    label="收信方式"
                    value={mailboxKindLabel(account.mailboxKind)}
                    copyText={mailboxKindLabel(account.mailboxKind)}
                  />
                  <Field label="收信密码" value={account.hasMailboxPass ? '已配置' : '未配置'} copyable={false} />
                  {account.oauthSourceAccountId && (
                    <Field
                      label="OAuth 来源"
                      value={`${account.oauthProvider || 'oauth'} · ${
                        accounts.find((x) => x.id === account.oauthSourceAccountId)?.label ||
                        account.oauthSourceAccountId.slice(0, 8)
                      }`}
                    />
                  )}
                  {accounts.some((x) => x.oauthSourceAccountId === account.id) && (
                    <Field
                      label="已授权注册"
                      value={accounts
                        .filter((x) => x.oauthSourceAccountId === account.id)
                        .map((x) => x.label || x.platform)
                        .join('、')}
                    />
                  )}
                  <Field label="分组" value={account.groupName} />
                  <Field
                    label="标签"
                    value={
                      account.tags.length ? (
                        <span className="flex flex-wrap justify-end gap-1">
                          {account.tags.map((t) => (
                            <Badge key={t} variant="secondary">
                              {t}
                            </Badge>
                          ))}
                        </span>
                      ) : null
                    }
                    copyText={account.tags.join(', ') || undefined}
                  />
                  <Field
                    label="代理"
                    value={account.proxyUrl ? <span className="font-mono text-xs">{account.proxyUrl}</span> : null}
                    copyText={account.proxyUrl}
                  />
                  <Field
                    label="浏览器身份"
                    value={
                      account.userAgent || account.locale || account.timezone ? (
                        <span className="text-xs" title={account.userAgent || undefined}>
                          {[account.locale, account.timezone].filter(Boolean).join(' · ') || '自定义 UA'}
                        </span>
                      ) : null
                    }
                    copyText={
                      [account.locale, account.timezone, account.userAgent].filter(Boolean).join(' · ') || undefined
                    }
                  />
                  <Field label="最近使用" value={relativeTime(account.lastUsedAt)} />
                  <Field label="创建时间" value={formatTime(account.createdAt)} />
                  <Field label="更新时间" value={formatTime(account.updatedAt)} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void testProxy()}
                    disabled={proxyProbe?.loading}
                    title="通过该账号的代理访问外网并读取出口 IP"
                  >
                    <Wifi className="h-4 w-4" /> {proxyProbe?.loading ? '测试中…' : '测试代理'}
                  </Button>
                  {proxyProbe && !proxyProbe.loading && (
                    <span className={`text-xs ${proxyProbe.ok ? 'text-success' : 'text-destructive'}`}>
                      {proxyProbe.text}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => void exportCookies()}>
                    <Cookie className="h-4 w-4" /> 导出 Cookie
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => cookieRef.current?.click()}>
                    <Cookie className="h-4 w-4" /> 导入 Cookie
                  </Button>
                  <input
                    ref={cookieRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => void onCookieFile(e)}
                  />
                  <span className="text-[11px] text-muted-foreground">预热 / 迁移登录态（含敏感令牌，妥善保管）</span>
                </div>

                <SectionTitle>凭据</SectionTitle>
                <div className="space-y-3">
                  <div className="group/secret rounded-lg border p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">密码</span>
                      {secrets?.password && (
                        <button
                          type="button"
                          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/secret:opacity-100"
                          onClick={() => setRevealPw((v) => !v)}
                          title={revealPw ? '隐藏' : '显示'}
                          aria-label={revealPw ? '隐藏密码' : '显示密码'}
                        >
                          {revealPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                    {secrets?.password ? (
                      <>
                        <CopyableValue
                          label="密码"
                          text={secrets.password}
                          align="left"
                          className="text-sm"
                        >
                          {revealPw ? secrets.password : '•'.repeat(Math.min(secrets.password.length, 24))}
                        </CopyableValue>
                        {sLabel && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${strength}%`,
                                  backgroundColor:
                                    sLabel.tone === 'success'
                                      ? 'hsl(var(--success))'
                                      : sLabel.tone === 'warning'
                                        ? 'hsl(var(--warning))'
                                        : 'hsl(var(--destructive))'
                                }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">强度 {sLabel.label}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">未设置</div>
                    )}
                  </div>

                  <div className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">两步验证 (2FA)</span>
                      {account.hasTotp && (
                        <Button variant="ghost" size="sm" className="h-7" onClick={() => setShowQr((v) => !v)}>
                          <QrCode className="h-4 w-4" /> {showQr ? '隐藏二维码' : '显示二维码'}
                        </Button>
                      )}
                    </div>
                    {account.hasTotp ? (
                      <div className="mt-2">
                        <TotpCell accountId={account.id} hasTotp={account.hasTotp} />
                        {showQr && secrets?.totpSecret && (
                          <div className="mt-3 flex flex-col items-center gap-2">
                            <TotpQR
                              secret={secrets.totpSecret}
                              issuer={platformMeta(account.platform).label}
                              account={account.email || account.username || account.label}
                            />
                            <p className="text-center text-[11px] text-muted-foreground">
                              用手机验证器 App 扫码即可添加此账号的 2FA。
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-1 text-sm text-muted-foreground">未设置</div>
                    )}
                  </div>

                  {account.hasBackupCodes && (
                    <div className="group/secret rounded-lg border p-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">备用验证码</span>
                        <button
                          type="button"
                          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/secret:opacity-100"
                          aria-label={revealCodes ? '隐藏备用码' : '显示备用码'}
                          title={revealCodes ? '隐藏' : '显示'}
                          onClick={() => setRevealCodes((v) => !v)}
                        >
                          {revealCodes ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <CopyableValue
                        label="备用码"
                        text={(secrets?.backupCodes ?? []).join('\n') || undefined}
                        align="left"
                      >
                        {revealCodes ? (
                          <span className="grid grid-cols-2 gap-1 font-mono text-xs">
                            {(secrets?.backupCodes ?? []).map((c, i) => (
                              <span key={i}>{c}</span>
                            ))}
                          </span>
                        ) : (
                          <span className="font-sans text-sm text-muted-foreground">
                            {(secrets?.backupCodes ?? []).length} 个（悬停显示，点击复制）
                          </span>
                        )}
                      </CopyableValue>
                    </div>
                  )}

                  {account.hasRefreshToken && (
                    <div className="group/secret rounded-lg border p-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Refresh Token</span>
                        <button
                          type="button"
                          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/secret:opacity-100"
                          aria-label={revealToken ? '隐藏 Token' : '显示 Token'}
                          title={revealToken ? '隐藏' : '显示'}
                          onClick={() => setRevealToken((v) => !v)}
                        >
                          {revealToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <CopyableValue label="Token" text={secrets?.refreshToken} align="left">
                        {revealToken ? secrets?.refreshToken : '••••••••••••••••'}
                      </CopyableValue>
                    </div>
                  )}
                </div>

                <SectionTitle>密码历史</SectionTitle>
                <div className="rounded-lg border">
                  <button
                    onClick={toggleHistory}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-accent/40"
                  >
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <History className="h-4 w-4" /> 历史密码
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {history ? `${history.length} 条` : '点击查看'}
                    </span>
                  </button>
                  {showHistory &&
                    (history === null ? (
                      <div className="px-3 pb-3">
                        <SkeletonRows rows={2} />
                      </div>
                    ) : history.length === 0 ? (
                      <div className="border-t px-3 py-3 text-xs text-muted-foreground">
                        暂无历史。更换密码后（手动或自动化）会自动记录上一版本，可在此回滚。
                      </div>
                    ) : (
                      <div className="divide-y border-t">
                        {history.map((h) => (
                          <div key={h.id} className="group/hist flex items-center gap-2 px-3 py-2">
                            <button
                              type="button"
                              className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left font-mono text-xs transition-colors hover:bg-primary/10"
                              title="点击复制该历史密码"
                              onClick={() => void copyHistory(h.id)}
                            >
                              {h.preview}
                            </button>
                            <span className="text-[11px] text-muted-foreground">{relativeTime(h.changedAt)}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 transition-opacity group-hover/hist:opacity-100"
                              title="恢复为该密码"
                              onClick={() => void restoreHistory(h.id)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>

                <SectionTitle>恢复信息</SectionTitle>
                <div className="divide-y">
                  <Field label="恢复邮箱" value={account.recoveryEmail} copyText={account.recoveryEmail} />
                  <Field label="恢复手机" value={account.recoveryPhone} copyText={account.recoveryPhone} />
                </div>

                {Object.keys(account.customFields).length > 0 && (
                  <>
                    <SectionTitle>自定义字段</SectionTitle>
                    <div className="divide-y">
                      {Object.entries(account.customFields).map(([k, v]) => (
                        <Field
                          key={k}
                          label={k}
                          value={v}
                          copyText={v}
                          secret={/token|secret|cookie|key|password|auth/i.test(k)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {account.notes && (
                  <>
                    <SectionTitle>备注</SectionTitle>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{account.notes}</p>
                  </>
                )}
              </div>
            </ScrollArea>

            <div className="border-t bg-muted/20 p-3">
              <div className="grid grid-cols-4 gap-1.5">
                {hasLocalApply(account.platform) ? (
                  <DrawerAction
                    icon={Play}
                    label="应用到本地"
                    primary
                    title={`写入本地 ${localApplyLabel(account.platform)}`}
                    onClick={() => void applyLocal()}
                  />
                ) : (
                  <DrawerAction
                    icon={Globe}
                    label="打开浏览器"
                    primary
                    title="打开该账号的独立浏览器"
                    onClick={() => void launchBrowser()}
                  />
                )}
                {hasLocalApply(account.platform) ? (
                  <DrawerAction
                    icon={Globe}
                    label="打开浏览器"
                    title="打开该账号的独立浏览器"
                    onClick={() => void launchBrowser()}
                  />
                ) : (
                  <DrawerAction icon={Play} label="运行自动化" onClick={() => setRunning(true)} />
                )}
                <DrawerAction icon={Inbox} label="读信" onClick={() => setMailOpen(true)} />
                <DrawerAction
                  icon={Mail}
                  label="用作收信"
                  title="用该账号的收信凭证创建邮箱服务，供批量注册收验证码"
                  onClick={() => {
                    void api.providers
                      .useAccountAsMailbox(account.id)
                      .then(() => toast.success('已加入服务中心，可作默认收信源'))
                      .catch((e) => toast.error((e as Error).message))
                  }}
                />
                <DrawerAction icon={Pencil} label="编辑" onClick={() => setEditing(true)} />
                <DrawerAction icon={Copy} label="克隆" onClick={() => setCloning(true)} />
                <DrawerAction
                  icon={FolderOpen}
                  label="配置目录"
                  title="打开该账号的浏览器配置目录"
                  onClick={() => void api.system.revealProfile(account.id)}
                />
                <DrawerAction icon={Trash2} label="删除" danger onClick={() => void onDelete()} />
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>

      {account && (
        <>
          <AccountDialog
            open={editing}
            account={account}
            onOpenChange={(v) => {
              setEditing(v)
              if (!v) void reveal()
            }}
          />
          <RunAutomationDialog
            open={running}
            accounts={[account]}
            onOpenChange={setRunning}
          />
          <CloneAccountDialog
            open={cloning}
            account={account}
            onOpenChange={setCloning}
            onDone={() => void reloadAccounts()}
          />
          <MailPeekDialog open={mailOpen} accountId={account.id} onOpenChange={setMailOpen} />
        </>
      )}
    </>
  )
}
