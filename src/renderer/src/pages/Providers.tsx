import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Inbox, Info, Mail, Plus, ShieldCheck, Smartphone, Trash2, Wifi, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ProviderSetting } from '@shared/types'
import {
  driversFor,
  getDriver,
  PROVIDER_TYPE_LABELS,
  type ProviderType
} from '@shared/providers'
import { api } from '@renderer/lib/api'
import { useProvidersStore } from '@renderer/store/providers'
import { useAppStore } from '@renderer/store/app'
import { ProviderConfigDialog } from '@renderer/components/ProviderConfigDialog'
import { SmsRentalsPanel } from '@renderer/components/SmsRentalsPanel'
import { InboxHistoryPanel } from '@renderer/components/InboxHistoryPanel'
import { OutlookPoolPanel } from '@renderer/components/OutlookPoolPanel'
import { MailPeekDialog } from '@renderer/components/MailPeekDialog'
import { Card, CardContent } from '@renderer/components/ui/card'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { SkeletonRows } from '@renderer/components/ui/skeleton'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Switch } from '@renderer/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'

const TABS: { type: ProviderType; icon: typeof Mail }[] = [
  { type: 'mailbox', icon: Mail },
  { type: 'captcha', icon: ShieldCheck },
  { type: 'sms', icon: Smartphone },
  { type: 'proxy', icon: Wifi }
]

const TAB_HINT: Record<ProviderType, string> = {
  mailbox: '注册时自动申请邮箱、收验证码或验证链接并填回，形成闭环。',
  captcha: '注册时用于自动求解 Turnstile / reCAPTCHA / hCaptcha。',
  sms: '注册需要手机验证时，用于租用号码并接收短信码。',
  proxy: '为浏览器 / 请求提供出口 IP，降低风控与频率限制。'
}

export default function Providers(): React.JSX.Element {
  const items = useProvidersStore((s) => s.items)
  const providersLoading = useProvidersStore((s) => s.loading)
  const load = useProvidersStore((s) => s.load)
  const openRegisterWithInboxes = useAppStore((s) => s.openRegisterWithInboxes)
  const remove = useProvidersStore((s) => s.remove)
  const setDefault = useProvidersStore((s) => s.setDefault)
  const saveProvider = useProvidersStore((s) => s.save)

  const [tab, setTab] = useState<ProviderType>('mailbox')
  const [dialog, setDialog] = useState<{ open: boolean; driver: string; editing: ProviderSetting | null }>({
    open: false,
    driver: '',
    editing: null
  })
  const [testingId, setTestingId] = useState<string | null>(null)
  const [peekId, setPeekId] = useState<string | null>(null)
  const [inboxPeekId, setInboxPeekId] = useState<string | null>(null)
  const [inboxTick, setInboxTick] = useState(0)

  useEffect(() => {
    void load()
  }, [load])

  const list = useMemo(() => items.filter((i) => i.type === tab), [items, tab])
  const drivers = driversFor(tab)

  const openAdd = (driver: string): void => setDialog({ open: true, driver, editing: null })
  const openEdit = (p: ProviderSetting): void =>
    setDialog({ open: true, driver: p.driver, editing: p })

  const onDelete = async (p: ProviderSetting): Promise<void> => {
    if (!window.confirm(`确认删除服务「${p.name}」？`)) return
    await remove(p.id)
    toast.success('已删除')
  }

  const toggleEnabled = async (p: ProviderSetting): Promise<void> => {
    await saveProvider({
      id: p.id,
      type: p.type,
      driver: p.driver,
      name: p.name,
      enabled: !p.enabled,
      isDefault: p.isDefault,
      config: p.config
    })
  }

  const testProvider = async (p: ProviderSetting): Promise<void> => {
    setTestingId(p.id)
    try {
      const r = await api.providers.test(p.id)
      if (r.ok) {
        toast.success(r.message)
        setInboxTick((n) => n + 1)
      } else toast.error(r.message)
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          服务中心用于接入自动化与<span className="text-foreground">批量注册</span>所需的外部能力：邮箱收码、验证码求解、短信接码、代理。
          上面「邮箱服务」是真实通道（iCloud / 自建 IMAP 等），点「测试」只测这条通道能不能收信。
          下面「已生成邮箱」是临时库存，和账号管理里添加的 Gmail / Outlook 不是一回事。注册请优先选账号库真实邮箱。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon
          const n = items.filter((i) => i.type === t.type).length
          return (
            <button
              key={t.type}
              onClick={() => setTab(t.type)}
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                tab === t.type
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {PROVIDER_TYPE_LABELS[t.type]}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{TAB_HINT[tab]}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" /> 添加{PROVIDER_TYPE_LABELS[tab]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" collisionPadding={16} className="w-80">
            {drivers.map((d) => (
              <DropdownMenuItem key={d.driver} className="items-start py-2" onClick={() => openAdd(d.driver)}>
                <div className="min-w-0">
                  <div>
                    {d.label}
                    {d.unimplemented ? '（未接入）' : ''}
                  </div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{d.description}</div>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Card>
        <CardContent className="p-0">
          {providersLoading && items.length === 0 ? (
            <div className="p-4">
              <SkeletonRows rows={3} />
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={Info}
              title={`还没有配置${PROVIDER_TYPE_LABELS[tab]}`}
              description="点击右上角「添加」并选择一个服务商。配置后即可在注册 / 自动化流程中自动调用。"
            />
          ) : (
            <div className="divide-y">
              {list.map((p) => {
                const def = getDriver(p.type, p.driver)
                return (
                  <div key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        {p.isDefault && (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" /> 默认
                          </Badge>
                        )}
                        {typeof p.config.poolRemaining === 'number' && (
                          <Badge variant="outline">剩余 {p.config.poolRemaining}</Badge>
                        )}
                        {!p.enabled && <Badge variant="secondary">已停用</Badge>}
                        {def?.unimplemented && <Badge variant="outline">未接入</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{def?.label ?? p.driver}</div>
                    </div>

                    {tab === 'mailbox' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPeekId(p.id)}
                        title="读取最近邮件"
                      >
                        <Inbox className="h-4 w-4" /> 读信
                      </Button>
                    )}
                    {def?.testable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void testProvider(p)}
                        disabled={testingId === p.id}
                        title="测试连通性"
                      >
                        <Wand2 className="h-4 w-4" /> {testingId === p.id ? '测试中…' : '测试'}
                      </Button>
                    )}

                    {!p.isDefault && (
                      <Button variant="ghost" size="sm" onClick={() => void setDefault(p.id)}>
                        设为默认
                      </Button>
                    )}

                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">启用</span>
                      <Switch checked={p.enabled} onCheckedChange={() => void toggleEnabled(p)} />
                    </div>

                    <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      title="删除"
                      onClick={() => void onDelete(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {tab === 'mailbox' && <OutlookPoolPanel />}
      {tab === 'mailbox' && (
        <InboxHistoryPanel
          refreshToken={inboxTick}
          onPeek={(id) => setInboxPeekId(id)}
          onRegister={(ids) => openRegisterWithInboxes(ids)}
        />
      )}
      {tab === 'sms' && <SmsRentalsPanel />}

      <MailPeekDialog
        open={!!peekId || !!inboxPeekId}
        providerId={peekId ?? undefined}
        generatedInboxId={inboxPeekId ?? undefined}
        onOpenChange={(v) => {
          if (!v) {
            setPeekId(null)
            setInboxPeekId(null)
          }
        }}
      />
      <ProviderConfigDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}
        type={tab}
        driver={dialog.driver}
        editing={dialog.editing}
      />
    </div>
  )
}
