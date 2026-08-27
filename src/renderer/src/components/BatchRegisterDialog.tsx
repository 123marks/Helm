import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Info, Rocket, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { GeneratedInbox, GoogleSignupMode, Platform, RegisterDraft } from '@shared/types'
import { emailDomain } from '@shared/accountDisplay'
import { GENDER_OPTIONS, MONTH_OPTIONS, draftIssues, isGoogleFamily, syncDraftIdentity } from '@shared/registerProfile'
import { api } from '@renderer/lib/api'
import { platformMeta } from '@renderer/lib/platforms'
import { PlatformGlyph } from '@renderer/components/PlatformBadge'
import { useAppStore } from '@renderer/store/app'
import { useAccountsStore } from '@renderer/store/accounts'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Checkbox } from '@renderer/components/ui/checkbox'
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

function platformHint(platform: Platform | ''): string {
  if (platform === 'google' || platform === 'youtube') {
    return 'Google 是多步向导：姓名 → 生日/性别 → 自建 @gmail.com 或使用已有邮箱 → 密码+确认密码。预览里每一项都会原样填进对应步骤，不会再随机改。'
  }
  if (platform === 'github') {
    return 'GitHub 是单页表单：邮箱 + 密码 + 用户名 + 国家，只点 Create account。预览用户名按 GitHub 规则生成，不要填邮箱前缀。'
  }
  if (platform === 'apple') return 'Apple ID 可用任意邮箱，风控强，建议关无头。'
  if (platform === 'x' || platform === 'discord') return '常要求手机号，请先配好接码或准备手动。'
  return '目标平台和收信邮箱是两回事：平台是要注册的网站，邮箱只负责收验证码。邮箱注册很容易触发人机：关无头、用住宅代理、每个账号独立指纹（新建时会自动写入 UA/语言/时区）。'
}

export function BatchRegisterDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}): React.JSX.Element {
  const setPage = useAppStore((s) => s.setPage)
  const prefillInboxIds = useAppStore((s) => s.registerPrefillInboxIds)
  const clearRegisterPrefill = useAppStore((s) => s.clearRegisterPrefill)
  const loadAccounts = useAccountsStore((s) => s.load)
  const accounts = useAccountsStore((s) => s.accounts)

  const [mode, setMode] = useState<'email' | 'oauth'>('email')
  const [step, setStep] = useState<'setup' | 'confirm'>('setup')
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [oauthPlatforms, setOauthPlatforms] = useState<Platform[]>([])
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [count, setCount] = useState(1)
  const [mailSource, setMailSource] = useState<'generate' | 'inboxes' | 'accounts' | 'pool'>('accounts')
  const [poolAvailable, setPoolAvailable] = useState<number | null>(null)
  const [inboxes, setInboxes] = useState<GeneratedInbox[]>([])
  const [inboxIds, setInboxIds] = useState<string[]>([])
  const [mailboxAccountIds, setMailboxAccountIds] = useState<string[]>([])
  const [mailboxReady, setMailboxReady] = useState<boolean | null>(null)
  const [oauthProvider, setOauthProvider] = useState<'google' | 'github'>('google')
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [drafts, setDrafts] = useState<RegisterDraft[]>([])
  const [busy, setBusy] = useState(false)

  const oauthSources = accounts.filter((a) => a.platform === oauthProvider && a.status === 'active')
  const mailboxAccounts = accounts.filter(
    (a) => a.email.includes('@') && (a.hasMailboxPass || a.hasRefreshToken || a.hasPassword)
  )
  const unusedInboxes = useMemo(
    () => inboxes.filter((x) => !x.accountId),
    [inboxes]
  )

  useEffect(() => {
    if (!open) return
    setStep('setup')
    setDrafts([])
    setCount(1)
    setSourceIds([])
    setMailboxAccountIds([])
    const prefill = prefillInboxIds.slice()
    setInboxIds(prefill)
    setMailSource(prefill.length > 0 ? 'inboxes' : 'generate')
    void api.automation.registerPlatforms().then((ps) => {
      setPlatforms(ps)
      if (mode === 'email') setPlatform((p) => p || ps[0] || '')
    })
    void api.automation.oauthPlatforms().then((ps) => {
      setOauthPlatforms(ps)
      if (mode === 'oauth') setPlatform((p) => p || ps[0] || '')
    })
    void api.providers.list('mailbox').then((list) => setMailboxReady(list.some((p) => p.enabled)))
    void api.providers.listInboxes().then(setInboxes)
    void api.outlookPool.stats().then((s) => setPoolAvailable(s.active + s.unchecked)).catch(() => setPoolAvailable(null))
  }, [open, mode, prefillInboxIds])

  const toggleId = (id: string, list: string[], set: (v: string[]) => void): void => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const prepare = async (): Promise<void> => {
    if (!platform) {
      toast.error('请选择要注册的平台')
      return
    }
    setBusy(true)
    try {
      const next = await api.automation.prepareRegister({
        platform,
        count: mailSource === 'generate' ? count : undefined,
        inboxIds: mailSource === 'inboxes' ? inboxIds : undefined,
        mailboxAccountIds: mailSource === 'accounts' ? mailboxAccountIds : undefined,
        outlookPoolCount: mailSource === 'pool' ? count : undefined
      })
      if (next.length === 0) {
        toast.error('没有可预览的邮箱')
        return
      }
      setDrafts(next)
      setStep('confirm')
    } catch (e) {
      toast.error('预览失败: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    if (!platform) return
    if (mode === 'email') {
      const issues = drafts.flatMap((d, i) => draftIssues(platform, d).map((msg) => `#${i + 1} ${msg}`))
      if (issues.length) {
        toast.error(issues[0])
        return
      }
    }
    setBusy(true)
    try {
      const r =
        mode === 'oauth'
          ? await api.automation.registerOauth(platform, sourceIds, oauthProvider)
          : await api.automation.confirmRegister(platform, drafts)
      await loadAccounts()
      if (r.created.length > 0) toast.success(`已提交 ${r.created.length} 个注册任务`)
      if (r.errors.length > 0) toast.error(`${r.errors.length} 个未能入队：${r.errors[0]}`)
      if (r.created.length > 0) {
        clearRegisterPrefill()
        onOpenChange(false)
        setPage('automation')
      }
    } catch (e) {
      toast.error('提交失败: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const patchDraft = (i: number, patch: Partial<RegisterDraft>): void => {
    if (!platform) return
    setDrafts((rows) =>
      rows.map((row, idx) => {
        if (idx !== i) return row
        const next = { ...row, ...patch }
        if (patch.password && !patch.confirmPassword && row.password === row.confirmPassword) {
          next.confirmPassword = patch.password
        }
        const synced = syncDraftIdentity(platform, next)
        if (!patch.label && (row.label === row.loginEmail || row.label === row.email)) {
          synced.label = synced.loginEmail
        }
        return synced
      })
    )
  }

  const emailReady =
    mailSource === 'generate'
      ? mailboxReady !== false
      : mailSource === 'pool'
        ? (poolAvailable ?? 0) > 0
        : mailSource === 'inboxes'
          ? inboxIds.length > 0
          : mailboxAccountIds.length > 0

  const confirmIssues = platform
    ? drafts.flatMap((d, i) => draftIssues(platform, d).map((msg) => `#${i + 1} ${msg}`))
    : []

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) clearRegisterPrefill()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{step === 'confirm' ? '确认注册信息' : '批量注册'}</DialogTitle>
          <DialogDescription>
            {step === 'confirm'
              ? '下面每一项都会原样写进注册页。登录邮箱和收信邮箱分开显示，不会互相改后缀。'
              : '先选要注册的网站和收信邮箱，预览确认后再开跑。'}
          </DialogDescription>
        </DialogHeader>

        {step === 'setup' ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button size="sm" variant={mode === 'email' ? 'default' : 'outline'} onClick={() => setMode('email')}>
                邮箱注册
              </Button>
              <Button size="sm" variant={mode === 'oauth' ? 'default' : 'outline'} onClick={() => setMode('oauth')}>
                OAuth 注册
              </Button>
            </div>

            {mailboxReady === false && mode === 'email' && mailSource === 'generate' && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="flex-1">
                  <p className="text-foreground">尚未配置可用的邮箱服务</p>
                  <p className="text-xs text-muted-foreground">也可改用「已生成邮箱」或带收信凭证的账号。</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false)
                    setPage('providers')
                  }}
                >
                  去配置
                </Button>
              </div>
            )}

            <div className="rounded-lg border bg-secondary/40 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <Info className="h-3.5 w-3.5 text-primary" /> 平台 ≠ 邮箱后缀
              </div>
              <p className="text-xs text-muted-foreground">{platformHint(platform)}</p>
              <p className="mt-2 text-xs text-warning">
                人机验证多半是出口 IP 和环境不像真人。每个新账号会自动写入独立 UA / 语言 / 时区；请关无头，并在账号里填住宅代理
                （http / socks5）。不要用机房 IP。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-primary/15 px-2 py-0.5 text-primary">1 · 选定收信邮箱</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="rounded bg-primary/15 px-2 py-0.5 text-primary">2 · 预览确认信息</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="rounded bg-primary/15 px-2 py-0.5 text-primary">3 · 浏览器注册 + 收码入库</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>要注册的平台</Label>
                <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择平台" />
                  </SelectTrigger>
                  <SelectContent>
                    {(mode === 'oauth' ? oauthPlatforms : platforms).map((p) => (
                      <SelectItem key={p} value={p} textValue={platformMeta(p).label}>
                        <span className="flex items-center gap-2">
                          <PlatformGlyph platform={p} size={16} />
                          {platformMeta(p).label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {mode === 'email' ? (
                <div className="space-y-1.5">
                  <Label>收信来源</Label>
                  <Select value={mailSource} onValueChange={(v) => setMailSource(v as typeof mailSource)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accounts">账号库真实邮箱（推荐）</SelectItem>
                      <SelectItem value="pool">
                        Outlook 池现成号{poolAvailable != null ? `（可用 ${poolAvailable}）` : ''}
                      </SelectItem>
                      <SelectItem value="inboxes">已生成的临时邮箱</SelectItem>
                      <SelectItem value="generate">再生成一批临时邮箱</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>授权方式</Label>
                  <Select value={oauthProvider} onValueChange={(v) => setOauthProvider(v as 'google' | 'github')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="google">Google</SelectItem>
                      <SelectItem value="github">GitHub</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {mode === 'email' && (mailSource === 'generate' || mailSource === 'pool') && (
              <div className="space-y-1.5">
                <Label>{mailSource === 'pool' ? '从池取号数量' : '生成数量'}</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                />
                {mailSource === 'pool' && (
                  <p className="text-xs text-muted-foreground">
                    每个号从 Outlook 池取一个现成微软邮箱来收码；注册成功后该平台账号入库，邮箱标记为已用。
                  </p>
                )}
              </div>
            )}

            {mode === 'email' && mailSource === 'inboxes' && (
              <div className="space-y-1.5">
                <Label>选择已生成且未占用的邮箱</Label>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {unusedInboxes.length === 0 && (
                    <p className="text-xs text-muted-foreground">没有空闲邮箱。请先到服务中心生成，或改用「新生成」。</p>
                  )}
                  {unusedInboxes.map((box) => (
                    <label key={box.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={inboxIds.includes(box.id)}
                        onCheckedChange={() => toggleId(box.id, inboxIds, setInboxIds)}
                      />
                      <span className="min-w-0 truncate font-mono text-xs">
                        {box.email}
                        <span className="ml-1 text-muted-foreground">{emailDomain(box.email)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {mode === 'email' && mailSource === 'accounts' && (
              <div className="space-y-1.5">
                <Label>选择带收信凭证的账号（Gmail / iCloud / Outlook 等）</Label>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {mailboxAccounts.length === 0 && (
                    <p className="text-xs text-muted-foreground">账号库里还没有可收信的邮箱。请先在编辑账号里填写收信方式。</p>
                  )}
                  {mailboxAccounts.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={mailboxAccountIds.includes(a.id)}
                        onCheckedChange={() => toggleId(a.id, mailboxAccountIds, setMailboxAccountIds)}
                      />
                      <span className="min-w-0 truncate text-xs">
                        {a.label || a.email} · {a.email}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {mode === 'oauth' && (
              <div className="space-y-1.5">
                <Label>授权源账号（可多选）</Label>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {oauthSources.length === 0 && (
                    <p className="text-xs text-muted-foreground">账号库中没有可用的 Google/GitHub 账号。</p>
                  )}
                  {oauthSources.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={sourceIds.includes(a.id)}
                        onCheckedChange={() => toggleId(a.id, sourceIds, setSourceIds)}
                      />
                      <span>
                        {a.label} · {a.email || a.username}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              将注册 <span className="font-medium">{platform ? platformMeta(platform).label : ''}</span>
              ，共 {drafts.length} 个。登录邮箱以「登录」栏为准，收信邮箱只负责收验证码。
            </p>
            <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
              {drafts.map((d, i) => (
                <div key={`${d.inboxId}-${d.email}-${i}`} className="space-y-3 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      收信 <span className="font-mono text-foreground">{d.email}</span>
                    </span>
                    <span>
                      {emailDomain(d.email) || '无域名'} · {d.driver}
                    </span>
                  </div>
                  <div className="rounded-md bg-secondary/50 px-2.5 py-1.5 font-mono text-sm">
                    登录 {d.loginEmail}
                  </div>
                  {d.loginEmail !== d.email && (
                    <p className="text-xs text-muted-foreground">
                      登录域名是 {emailDomain(d.loginEmail) || '—'}，收信域名是 {emailDomain(d.email) || '—'}
                      ，两者本来就可以不同。
                    </p>
                  )}
                  {platform && draftIssues(platform, d).length > 0 && (
                    <p className="text-xs text-destructive">{draftIssues(platform, d).join('；')}</p>
                  )}
                  {d.confirmPassword && d.confirmPassword !== d.password && (
                    <p className="text-xs text-destructive">两次密码不一致</p>
                  )}

                  {platform && isGoogleFamily(platform) && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">邮箱方式</Label>
                        <Select
                          value={d.googleMode}
                          onValueChange={(v) => patchDraft(i, { googleMode: v as GoogleSignupMode })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="gmail">自建 @gmail.com</SelectItem>
                            <SelectItem value="existing">使用上面的收信邮箱登录</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {d.googleMode === 'gmail' && (
                        <div className="space-y-1">
                          <Label className="text-xs">Gmail 用户名</Label>
                          <div className="flex items-center gap-1">
                            <Input
                              value={d.username}
                              onChange={(e) => patchDraft(i, { username: e.target.value })}
                              className="font-mono"
                            />
                            <span className="shrink-0 text-xs text-muted-foreground">@gmail.com</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {platform && isGoogleFamily(platform) && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">名 First name</Label>
                        <Input value={d.firstName} onChange={(e) => patchDraft(i, { firstName: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">姓 Last name</Label>
                        <Input value={d.lastName} onChange={(e) => patchDraft(i, { lastName: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">月</Label>
                        <Select value={d.birthMonth} onValueChange={(v) => patchDraft(i, { birthMonth: v })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MONTH_OPTIONS.map((m) => (
                              <SelectItem key={m.value} value={m.value}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">日</Label>
                          <Input value={d.birthDay} onChange={(e) => patchDraft(i, { birthDay: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">年</Label>
                          <Input value={d.birthYear} onChange={(e) => patchDraft(i, { birthYear: e.target.value })} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">性别</Label>
                        <Select value={d.gender} onValueChange={(v) => patchDraft(i, { gender: v })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {GENDER_OPTIONS.map((g) => (
                              <SelectItem key={g.value} value={g.value}>
                                {g.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    {!(platform && isGoogleFamily(platform) && d.googleMode === 'gmail') && (
                      <div className="space-y-1">
                        <Label className="text-xs">{platform === 'github' ? 'GitHub 用户名' : '用户名'}</Label>
                        <Input
                          value={d.username}
                          onChange={(e) => patchDraft(i, { username: e.target.value })}
                          className="font-mono"
                        />
                      </div>
                    )}
                    {platform === 'github' && (
                      <div className="space-y-1">
                        <Label className="text-xs">国家 / 地区</Label>
                        <Input value={d.country} onChange={(e) => patchDraft(i, { country: e.target.value })} />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">密码</Label>
                      <Input
                        value={d.password}
                        onChange={(e) => patchDraft(i, { password: e.target.value })}
                        className="font-mono"
                      />
                    </div>
                    {platform && (isGoogleFamily(platform) || platform === 'microsoft' || platform === 'apple') ? (
                      <div className="space-y-1">
                        <Label className="text-xs">确认密码</Label>
                        <Input
                          value={d.confirmPassword}
                          onChange={(e) => patchDraft(i, { confirmPassword: e.target.value })}
                          className="font-mono"
                        />
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <Label className="text-xs">标签</Label>
                      <Input value={d.label} onChange={(e) => patchDraft(i, { label: e.target.value })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'confirm' ? (
            <>
              <Button variant="outline" onClick={() => setStep('setup')} disabled={busy}>
                返回修改
              </Button>
              <Button onClick={() => void confirm()} disabled={busy || drafts.length === 0 || confirmIssues.length > 0}>
                <Rocket className="h-4 w-4" /> {busy ? '提交中…' : `确认注册 (${drafts.length})`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              {mode === 'oauth' ? (
                <Button onClick={() => void confirm()} disabled={busy || !platform || sourceIds.length === 0}>
                  <Rocket className="h-4 w-4" /> {busy ? '提交中…' : `开始注册 (${sourceIds.length})`}
                </Button>
              ) : (
                <Button onClick={() => void prepare()} disabled={busy || !platform || !emailReady}>
                  {busy ? '生成预览…' : '预览并确认'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
