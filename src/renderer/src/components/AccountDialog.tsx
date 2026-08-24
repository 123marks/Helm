import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Eye, EyeOff, FileKey, FileUp, Fingerprint, Globe, Inbox, Link2, Plus, QrCode, SlidersHorizontal, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Account, AccountInput, AccountStatus, Platform } from '@shared/types'
import { MAILBOX_KINDS, mailboxKindHelp, suggestMailboxKind, type MailboxKind } from '@shared/mailboxAccount'
import { estimatePasswordStrength, strengthLabel } from '@shared/security'
import { api } from '@renderer/lib/api'
import { parseAccountPaste } from '@renderer/lib/accountPaste'
import { parseTokenFile, parseTokenText } from '@shared/tokenImport'
import { officialLoginUrl } from '@shared/officialLogin'
import { randomIdentity } from '@renderer/lib/identity'
import { genPassword } from '@renderer/lib/utils'
import { decodeQrFromFile } from '@renderer/lib/qr'
import { hasOfficialAuth, hasQuota, PLATFORMS, platformMeta } from '@renderer/lib/platforms'
import { OfficialAuthPanel } from '@renderer/components/OfficialAuthPanel'
import { PlatformGlyph } from '@renderer/components/PlatformBadge'
import { PasswordGeneratorDialog } from '@renderer/components/PasswordGeneratorDialog'
import { useAccountsStore } from '@renderer/store/accounts'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Textarea } from '@renderer/components/ui/textarea'
import { Separator } from '@renderer/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

interface FormState {
  platform: Platform
  label: string
  username: string
  email: string
  password: string
  totpSecret: string
  recoveryEmail: string
  recoveryPhone: string
  backupCodesText: string
  refreshToken: string
  groupName: string
  tagsText: string
  proxyUrl: string
  userAgent: string
  locale: string
  timezone: string
  customFields: { key: string; value: string }[]
  notes: string
  status: AccountStatus
  mailboxKind: MailboxKind
  mailboxAppPassword: string
  mailboxClientId: string
}

const EMPTY: FormState = {
  platform: 'google',
  label: '',
  username: '',
  email: '',
  password: '',
  totpSecret: '',
  recoveryEmail: '',
  recoveryPhone: '',
  backupCodesText: '',
  refreshToken: '',
  groupName: '',
  tagsText: '',
  proxyUrl: '',
  userAgent: '',
  locale: '',
  timezone: '',
  customFields: [],
  notes: '',
  status: 'active',
  mailboxKind: '',
  mailboxAppPassword: '',
  mailboxClientId: ''
}

function PasswordStrength({ value }: { value: string }): React.JSX.Element {
  const score = estimatePasswordStrength(value)
  const { label, tone } = strengthLabel(score)
  const color =
    tone === 'success'
      ? 'hsl(var(--success))'
      : tone === 'warning'
        ? 'hsl(var(--warning))'
        : 'hsl(var(--destructive))'
  return (
    <div className="flex items-center gap-2 pt-0.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-14 text-right text-xs" style={{ color }}>
        强度：{label}
      </span>
    </div>
  )
}

export function AccountDialog({
  open,
  onOpenChange,
  account
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  account: Account | null
}): React.JSX.Element {
  const create = useAccountsStore((s) => s.create)
  const update = useAccountsStore((s) => s.update)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [showPwd, setShowPwd] = useState(false)
  const [preview, setPreview] = useState('')
  const [uri, setUri] = useState('')
  const [saving, setSaving] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [tab, setTab] = useState<'oauth' | 'token' | 'manual'>('manual')
  const [paste, setPaste] = useState('')
  const [showMailboxPwd, setShowMailboxPwd] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const jsonFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setShowPwd(false)
    setShowMailboxPwd(false)
    setUri('')
    setPaste('')
    if (account) {
      void (async () => {
        const s = await api.accounts.reveal(account.id)
        setForm({
          platform: account.platform,
          label: account.label,
          username: account.username,
          email: account.email,
          password: s.password ?? '',
          totpSecret: s.totpSecret ?? '',
          recoveryEmail: account.recoveryEmail,
          recoveryPhone: account.recoveryPhone,
          backupCodesText: (s.backupCodes ?? []).join('\n'),
          refreshToken: s.refreshToken ?? '',
          groupName: account.groupName,
          tagsText: account.tags.join(', '),
          proxyUrl: account.proxyUrl,
          userAgent: account.userAgent,
          locale: account.locale,
          timezone: account.timezone,
          customFields: Object.entries(account.customFields).map(([key, value]) => ({ key, value })),
          notes: account.notes,
          status: account.status,
          mailboxKind: (account.mailboxKind || suggestMailboxKind(account.platform, account.email)) as MailboxKind,
          mailboxAppPassword: s.mailboxAppPassword ?? '',
          mailboxClientId: account.mailboxClientId
        })
      })()
    } else {
      setForm(EMPTY)
      setTab('manual')
    }
  }, [open, account])

  const oauthReady = !account && hasOfficialAuth(form.platform)

  useEffect(() => {
    if (!open || account) return
    setTab(oauthReady ? 'oauth' : hasQuota(form.platform) ? 'token' : 'manual')
  }, [open, account, form.platform, oauthReady])

  const onOAuthDone = useCallback(
    (input: AccountInput) => {
      void (async () => {
        try {
          const acc = await create(input)
          toast.success(
            hasQuota(acc.platform) ? '授权成功，正在后台同步额度' : '授权成功，账号已保存'
          )
          onOpenChange(false)
        } catch (e) {
          toast.error((e as Error).message)
        }
      })()
    },
    [create, onOpenChange]
  )

  useEffect(() => {
    let active = true
    if (!form.totpSecret) {
      setPreview('')
      return
    }
    const run = async (): Promise<void> => {
      const r = await api.totp.preview(form.totpSecret)
      if (active) setPreview(r?.code ?? '无效')
    }
    void run()
    const id = window.setInterval(run, 1000)
    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [form.totpSecret])

  const set = (patch: Partial<FormState>): void => setForm((f) => ({ ...f, ...patch }))

  const applyParsed = (input: AccountInput): void => {
    set({
      platform: input.platform,
      label: input.label,
      username: input.username,
      email: input.email,
      password: input.password || '',
      totpSecret: input.totpSecret || '',
      recoveryEmail: input.recoveryEmail || '',
      recoveryPhone: input.recoveryPhone || '',
      refreshToken: input.refreshToken || '',
      notes: input.notes || '',
      locale: input.locale || '',
      timezone: input.timezone || '',
      customFields: Object.entries(input.customFields || {}).map(([key, value]) => ({ key, value })),
      tagsText: (input.tags || []).join(', '),
      mailboxKind: (input.mailboxKind || suggestMailboxKind(input.platform, input.email)) as MailboxKind,
      mailboxClientId: input.mailboxClientId || form.mailboxClientId
    })
  }

  const onPasteText = (text: string): void => {
    setPaste(text)
    const token = parseTokenText(text, form.platform)
    if (token) {
      applyParsed(token)
      return
    }
    const rows = parseAccountPaste(text)
    if (rows.length === 1) applyParsed(rows[0])
  }

  const importRows = async (rows: AccountInput[], singleHint: string): Promise<void> => {
    if (rows.length === 0) {
      toast.error('没有解析出账号')
      return
    }
    if (rows.length === 1) {
      applyParsed(rows[0])
      toast.success(singleHint)
      return
    }
    setSaving(true)
    try {
      for (const row of rows) await create(row)
      toast.success(`已导入 ${rows.length} 个账号`)
      onOpenChange(false)
    } catch (e) {
      toast.error('导入失败: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const importPasted = async (): Promise<void> => {
    const tokens = parseTokenFile(paste, form.platform)
    if (tokens.length > 0) {
      await importRows(tokens, '已从 JSON / Token 填入，确认后点保存')
      return
    }
    const rows = parseAccountPaste(paste)
    if (rows.length === 0) {
      toast.error('没有解析出账号。支持 JSON Token、.json 文件，或 邮箱----密码----恢复邮箱----2FA')
      return
    }
    await importRows(rows, '已填入表单，确认后点保存')
  }

  const importJsonFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setPaste(text)
      const rows = parseTokenFile(text, form.platform)
      if (rows.length === 0) {
        toast.error('无法识别该 JSON 文件。请确认是 Token、会话 JSON，或账号对象数组')
        return
      }
      await importRows(rows, `已从 ${file.name} 填入，确认后点保存`)
    } catch (err) {
      toast.error('读取文件失败: ' + (err as Error).message)
    } finally {
      if (jsonFileRef.current) jsonFileRef.current.value = ''
    }
  }

  const importUri = async (): Promise<void> => {
    const r = await api.totp.parseUri(uri.trim())
    if (!r) {
      toast.error('无法解析该 otpauth URI')
      return
    }
    set({ totpSecret: r.secret })
    if (!form.label && r.label) set({ label: r.label })
    toast.success('已导入 2FA 密钥')
  }

  const pickQr = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await decodeQrFromFile(file)
    if (!text) {
      toast.error('未识别到二维码')
    } else {
      const r = await api.totp.parseUri(text)
      if (r) {
        set({ totpSecret: r.secret })
        toast.success('已从二维码导入 2FA 密钥')
      } else {
        set({ totpSecret: text })
        toast.message('已读取二维码内容，请确认密钥')
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const showOAuth = oauthReady && tab === 'oauth'
  const showToken = !account && hasQuota(form.platform) && tab === 'token'
  const showManual = Boolean(account) || tab === 'manual' || !hasQuota(form.platform)

  const submit = async (): Promise<void> => {
    const pastedTokens = showToken && paste.trim() ? parseTokenFile(paste, form.platform) : []
    if (pastedTokens.length > 1) {
      await importRows(pastedTokens, '')
      return
    }
    const parsedToken =
      pastedTokens[0] || (form.refreshToken ? parseTokenText(form.refreshToken, form.platform) : null)
    const label =
      form.label.trim() ||
      parsedToken?.label ||
      form.email.trim() ||
      parsedToken?.email ||
      form.username.trim() ||
      parsedToken?.username ||
      ''
    if (!label) {
      toast.error(showToken ? '请粘贴 Token / JSON，或导入 .json 文件' : '请填写标签名或邮箱')
      return
    }
    setSaving(true)
    try {
      const customFields = {
        ...Object.fromEntries(
          form.customFields
            .map((f) => [f.key.trim(), f.value] as const)
            .filter(([k]) => k.length > 0)
        ),
        ...(parsedToken?.customFields || {})
      }
      const input: AccountInput = {
        platform: form.platform,
        label,
        username: form.username.trim() || parsedToken?.username || '',
        email: form.email.trim() || parsedToken?.email || '',
        password: form.password || null,
        totpSecret: form.totpSecret || null,
        recoveryEmail: form.recoveryEmail.trim(),
        recoveryPhone: form.recoveryPhone.trim(),
        backupCodes: form.backupCodesText
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
        refreshToken: parsedToken?.refreshToken || form.refreshToken || null,
        groupName: form.groupName.trim(),
        tags: form.tagsText
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        proxyUrl: form.proxyUrl.trim(),
        userAgent: form.userAgent.trim(),
        locale: form.locale.trim(),
        timezone: form.timezone.trim(),
        customFields,
        notes: form.notes,
        status: form.status,
        mailboxKind: form.mailboxKind,
        mailboxAppPassword: form.mailboxAppPassword || null,
        mailboxClientId: form.mailboxClientId.trim() || parsedToken?.mailboxClientId || ''
      }
      if (account) {
        await update(account.id, input)
        toast.success('已保存修改')
      } else {
        await create(input)
        toast.success('账号已创建')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error('保存失败: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        onInteractOutside={(e) => genOpen && e.preventDefault()}
        onEscapeKeyDown={(e) => genOpen && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {account
              ? '编辑账号'
              : hasQuota(form.platform)
                ? `添加 ${platformMeta(form.platform).label} 账号`
                : '新增账号'}
          </DialogTitle>
          <DialogDescription>
            {showOAuth
              ? '打开官方登录页完成授权，成功后自动建号。也可改用 Token / JSON 或手动填写。'
              : showToken
                ? '粘贴 Token / 会话 JSON，或直接导入 .json 文件。不需要填密码和 2FA。'
                : '密码、2FA、Token 本地加密。支持 邮箱----密码----恢复邮箱----2FA 分隔。'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-5 overflow-y-auto pr-1">
          {!account && hasQuota(form.platform) && (
            <div className={`grid gap-1 rounded-lg border bg-secondary/40 p-1 ${oauthReady ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {oauthReady && (
                <button
                  type="button"
                  className={`rounded-md px-2 py-1.5 text-sm ${tab === 'oauth' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setTab('oauth')}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5" /> OAuth 授权
                  </span>
                </button>
              )}
              <button
                type="button"
                className={`rounded-md px-2 py-1.5 text-sm ${tab === 'token' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setTab('token')}
              >
                <span className="inline-flex items-center gap-1.5">
                  <FileKey className="h-3.5 w-3.5" /> Token / JSON
                </span>
              </button>
              <button
                type="button"
                className={`rounded-md px-2 py-1.5 text-sm ${tab === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setTab('manual')}
              >
                手动填写
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>平台</Label>
              <Select
                value={form.platform}
                onValueChange={(v) => {
                  const platform = v as Platform
                  set({
                    platform,
                    mailboxKind: form.mailboxKind || suggestMailboxKind(platform, form.email)
                  })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.key} value={p.key} textValue={p.label}>
                      <span className="flex items-center gap-2">
                        <PlatformGlyph platform={p.key} size={16} />
                        {p.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!showOAuth && (
              <div className="space-y-1.5">
                <Label>状态</Label>
                <Select value={form.status} onValueChange={(v) => set({ status: v as AccountStatus })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">正常</SelectItem>
                    <SelectItem value="disabled">停用</SelectItem>
                    <SelectItem value="error">异常</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {showOAuth && (
            <OfficialAuthPanel
              platform={form.platform}
              onDone={onOAuthDone}
              onCreated={() => onOpenChange(false)}
            />
          )}

          {showToken && (
            <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label>Token / JSON</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    粘贴会话 Token、Cookie JSON、或官方导出的账号 JSON。也支持一次导入多个账号的数组。
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => jsonFileRef.current?.click()}>
                  <FileUp className="h-3.5 w-3.5" /> 导入 JSON 文件
                </Button>
                <input
                  ref={jsonFileRef}
                  type="file"
                  accept=".json,application/json,text/plain"
                  className="hidden"
                  onChange={(e) => void importJsonFile(e)}
                />
              </div>
              <Textarea
                value={paste}
                onChange={(e) => onPasteText(e.target.value)}
                placeholder={
                  form.platform === 'kiro'
                    ? '{"refreshToken":"...","clientId":"...","email":"..."}'
                    : form.platform === 'cursor'
                      ? 'WorkosCursorSessionToken、userId::JWT，或含 token 的 JSON'
                      : form.platform === 'anthropic'
                        ? 'sk-ant-sid01-… 或 {"sessionKey":"...","lastActiveOrg":"..."}'
                        : form.platform === 'openai'
                          ? 'ChatGPT session-token，或浏览器导出的 Cookie JSON'
                          : form.platform === 'windsurf'
                            ? 'sk-ws-01-… 或 {"apiKey":"sk-ws-01-..."}'
                            : form.platform === 'grok'
                              ? 'xai-… API Key，或 grok.com Cookie JSON'
                              : form.platform === 'antigravity'
                                ? 'Google refresh_token / oauth_creds.json（含 access_token + refresh_token）'
                            : '粘贴 Token 或 JSON'
                }
                className="min-h-[160px] font-mono text-xs"
                rows={8}
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>标签名（可选）</Label>
                  <Input
                    value={form.label}
                    onChange={(e) => set({ label: e.target.value })}
                    placeholder="可留空，默认用邮箱或 Token"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>邮箱（可选）</Label>
                  <Input
                    value={form.email}
                    onChange={(e) => set({ email: e.target.value })}
                    placeholder="JSON 里有邮箱会自动填"
                  />
                </div>
              </div>
              {(form.refreshToken || form.email || form.username) && (
                <p className="text-xs text-muted-foreground">
                  已识别
                  {form.email ? ` · ${form.email}` : ''}
                  {form.username ? ` · ${form.username}` : ''}
                  {form.refreshToken ? ` · Token ${form.refreshToken.slice(0, 18)}…` : ''}
                </p>
              )}
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => void importPasted()} disabled={!paste.trim()}>
                  {parseTokenFile(paste, form.platform).length > 1
                    ? `导入 ${parseTokenFile(paste, form.platform).length} 个账号`
                    : '解析并填入'}
                </Button>
              </div>
            </div>
          )}

          {showManual && !account && (
            <div className="space-y-1.5">
              <Label>快捷粘贴（一行一个，自动拆分）</Label>
              <Textarea
                value={paste}
                onChange={(e) => onPasteText(e.target.value)}
                placeholder={'name@gmail.com----password----recovery@hotmail.com----totpsecret'}
                className="font-mono text-xs"
                rows={3}
              />
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => void importPasted()} disabled={!paste.trim()}>
                  {parseAccountPaste(paste).length > 1
                    ? `导入 ${parseAccountPaste(paste).length} 个账号`
                    : '填入表单'}
                </Button>
              </div>
            </div>
          )}

          {showManual && (
          <>
          <div className="space-y-1.5">
            <Label>标签名</Label>
            <Input
              value={form.label}
              onChange={(e) => set({ label: e.target.value })}
              placeholder="可留空，默认用邮箱显示"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>用户名</Label>
              <Input value={form.username} onChange={(e) => set({ username: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>邮箱</Label>
              <Input
                value={form.email}
                onChange={(e) => {
                  const email = e.target.value
                  set({
                    email,
                    mailboxKind: form.mailboxKind || suggestMailboxKind(form.platform, email)
                  })
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (text.includes('----') || text.includes('|') || /----|---/.test(text)) {
                    e.preventDefault()
                    onPasteText(text)
                  }
                }}
                placeholder="name@example.com 或整行粘贴"
              />
            </div>
          </div>

          <Separator />
          <div className="space-y-1.5">
            <Label>密码</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPwd ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => set({ password: e.target.value })}
                  placeholder="登录密码"
                  className="pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button type="button" variant="outline" size="icon" title="快速生成强密码" onClick={() => set({ password: genPassword(16) })}>
                <Wand2 className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" title="密码生成器（可配置）" onClick={() => setGenOpen(true)}>
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="复制"
                onClick={() => {
                  if (form.password) {
                    void navigator.clipboard.writeText(form.password)
                    toast.success('密码已复制')
                  }
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {form.password && <PasswordStrength value={form.password} />}
          </div>

          <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center gap-1.5">
              <Inbox className="h-4 w-4 text-primary" />
              <Label>收信方式（读验证码 / 验证链接）</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Google / Apple / 微软都能收信，但凭证不同。登录密码通常不能 IMAP；Gmail 和 iCloud 必须填应用专用密码。
            </p>
            <Select
              value={form.mailboxKind || '__none__'}
              onValueChange={(v) => set({ mailboxKind: (v === '__none__' ? '' : v) as MailboxKind })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAILBOX_KINDS.map((k) => (
                  <SelectItem key={k.value || '__none__'} value={k.value || '__none__'}>
                    {k.label}
                  </SelectItem>
                ))}
                {form.mailboxKind && !MAILBOX_KINDS.some((k) => k.value === form.mailboxKind) && (
                  <SelectItem value={form.mailboxKind}>已绑定邮箱服务 · {form.mailboxKind}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{mailboxKindHelp(form.mailboxKind)}</p>
            {form.mailboxKind && form.mailboxKind !== 'outlook_graph' && (
              <div className="relative">
                <Input
                  type={showMailboxPwd ? 'text' : 'password'}
                  value={form.mailboxAppPassword}
                  onChange={(e) => set({ mailboxAppPassword: e.target.value })}
                  placeholder="收信专用密码（应用专用密码，不是登录密码）"
                  className="pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowMailboxPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showMailboxPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}
            {form.mailboxKind === 'outlook_graph' && (
              <div className="space-y-2">
                <Input
                  value={form.mailboxClientId}
                  onChange={(e) => set({ mailboxClientId: e.target.value })}
                  placeholder="Azure 应用 client_id"
                  className="font-mono text-xs"
                />
                <div className="relative">
                  <Input
                    type={showMailboxPwd ? 'text' : 'password'}
                    value={form.mailboxAppPassword}
                    onChange={(e) => set({ mailboxAppPassword: e.target.value })}
                    placeholder="可选：Outlook 应用密码（Graph 失败时回退 IMAP）"
                    className="pr-9 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMailboxPwd((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showMailboxPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Refresh token 填在下方「Refresh Token」字段。</p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>两步验证 (TOTP) 密钥</Label>
              {preview && (
                <span className="font-mono text-sm font-semibold text-primary">当前: {preview}</span>
              )}
            </div>
            <Input
              value={form.totpSecret}
              onChange={(e) => set({ totpSecret: e.target.value })}
              placeholder="Base32 密钥，如 JBSWY3DPEHPK3PXP"
              className="font-mono"
            />
            <div className="flex gap-2">
              <Input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="粘贴 otpauth://totp/... URI" className="flex-1 font-mono text-xs" />
              <Button type="button" variant="outline" onClick={importUri} disabled={!uri.trim()}>
                <Link2 className="h-4 w-4" /> 解析
              </Button>
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <QrCode className="h-4 w-4" /> 二维码
              </Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickQr} />
            </div>
          </div>

          <Separator />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>恢复邮箱</Label>
              <Input value={form.recoveryEmail} onChange={(e) => set({ recoveryEmail: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>恢复手机</Label>
              <Input value={form.recoveryPhone} onChange={(e) => set({ recoveryPhone: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>备用验证码（每行一个）</Label>
            <Textarea
              value={form.backupCodesText}
              onChange={(e) => set({ backupCodesText: e.target.value })}
              placeholder={'1234-5678\n2345-6789'}
              className="font-mono text-xs"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              {form.platform === 'kiro'
                ? 'Kiro Token / JSON（refreshToken）'
                : form.platform === 'cursor'
                  ? 'Cursor Session Token'
                  : form.platform === 'anthropic'
                    ? 'Claude sessionKey / JSON'
                    : form.platform === 'openai'
                      ? 'ChatGPT Session Token / Cookie JSON'
                      : form.platform === 'windsurf'
                        ? 'Windsurf API Key / JSON'
                        : form.platform === 'grok'
                          ? 'Grok / xAI Token'
                          : form.platform === 'antigravity'
                            ? 'Antigravity · Google Token'
                        : 'Refresh Token'}
            </Label>
            <Textarea
              value={form.refreshToken}
              onChange={(e) => set({ refreshToken: e.target.value })}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text')
                const parsed = parseTokenText(text, form.platform)
                if (!parsed) return
                e.preventDefault()
                applyParsed({ ...parsed, platform: parsed.platform || form.platform })
                toast.success('已识别 Token / JSON 并填入')
              }}
              placeholder={
                form.platform === 'kiro'
                  ? '{"refreshToken":"...","clientId":"...","clientSecret":"...","email":"..."}'
                  : form.platform === 'cursor'
                    ? 'WorkosCursorSessionToken、userId::JWT，或含 token 的 JSON'
                    : form.platform === 'anthropic'
                      ? 'sk-ant-sid01-… 或 {"sessionKey":"...","lastActiveOrg":"..."}'
                      : form.platform === 'openai'
                        ? 'ChatGPT session-token，或从浏览器导出的 Cookie JSON'
                        : form.platform === 'windsurf'
                          ? 'sk-ws-01-… 或 {"apiKey":"sk-ws-01-..."}'
                          : form.platform === 'grok'
                            ? 'xai-… 或 grok.com Cookie JSON'
                            : form.platform === 'antigravity'
                              ? '1//… refresh_token，或 ~/.gemini/oauth_creds.json'
                          : ''
              }
              className="font-mono text-xs"
              rows={3}
            />
            {account && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void (async () => {
                    const r = await api.automation.launchProfile(account.id, officialLoginUrl(form.platform))
                    if (r.ok) toast.success(r.message)
                    else toast.error(r.message)
                  })()
                }}
              >
                官方授权登录
              </Button>
            )}
            {hasQuota(form.platform) && !account && (
              <p className="text-[11px] text-muted-foreground">
                保存后可点「官方授权登录」。登录完关掉窗口，再刷新额度会抓会话。
              </p>
            )}
            {hasQuota(form.platform) && account && (
              <p className="text-[11px] text-muted-foreground">
                登录完关掉窗口，回到卡片点刷新额度。粘贴的 Token 会写入该账号独立 Chrome。
              </p>
            )}
          </div>

          <Separator />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>分组</Label>
              <Input value={form.groupName} onChange={(e) => set({ groupName: e.target.value })} placeholder="默认分组" />
            </div>
            <div className="space-y-1.5">
              <Label>标签（逗号分隔）</Label>
              <Input value={form.tagsText} onChange={(e) => set({ tagsText: e.target.value })} placeholder="工作, 长期" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>代理地址（可选）</Label>
            <Input
              value={form.proxyUrl}
              onChange={(e) => set({ proxyUrl: e.target.value })}
              placeholder="http://user:pass@host:port 或 socks5://host:port"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              为该账号指定独立出口 IP（不同账号=不同网络环境）；留空则使用「服务中心」的默认代理。推荐
              HTTP(S) 代理；Chromium 不支持带账号密码的 SOCKS5。
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <Fingerprint className="h-4 w-4 text-primary" /> 浏览器身份（可选）
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const id = randomIdentity()
                  set({ userAgent: id.userAgent, locale: id.locale, timezone: id.timezone })
                }}
              >
                <Wand2 className="h-3.5 w-3.5" /> 随机生成一套
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              让该账号的独立浏览器呈现不同的 UA / 语言 / 时区 + 画布/WebGL 噪声，降低多账号被关联的风险。留空使用系统默认。
            </p>
            <Input
              value={form.userAgent}
              onChange={(e) => set({ userAgent: e.target.value })}
              placeholder="User-Agent（留空用默认）"
              className="font-mono text-xs"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={form.locale}
                onChange={(e) => set({ locale: e.target.value })}
                placeholder="语言，如 en-US"
                className="font-mono text-xs"
              />
              <Input
                value={form.timezone}
                onChange={(e) => set({ timezone: e.target.value })}
                placeholder="时区，如 America/New_York"
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>自定义字段</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set({ customFields: [...form.customFields, { key: '', value: '' }] })}
              >
                <Plus className="h-3.5 w-3.5" /> 添加字段
              </Button>
            </div>
            {form.customFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                可存放安全问题、会员号、备用邮箱等任意键值对（加密存储）。
              </p>
            ) : (
              <div className="space-y-2">
                {form.customFields.map((f, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={f.key}
                      onChange={(e) => {
                        const next = [...form.customFields]
                        next[i] = { ...next[i], key: e.target.value }
                        set({ customFields: next })
                      }}
                      placeholder="字段名"
                      className="w-1/3"
                    />
                    <Input
                      value={f.value}
                      onChange={(e) => {
                        const next = [...form.customFields]
                        next[i] = { ...next[i], value: e.target.value }
                        set({ customFields: next })
                      }}
                      placeholder="值"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="删除"
                      onClick={() => set({ customFields: form.customFields.filter((_, j) => j !== i) })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>备注</Label>
            <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} />
          </div>
          </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          {!showOAuth && (
            <Button onClick={submit} disabled={saving}>
              {saving ? '保存中…' : showToken ? '导入并保存' : '保存'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <PasswordGeneratorDialog open={genOpen} onOpenChange={setGenOpen} onUse={(pw) => set({ password: pw })} />
    </>
  )
}
