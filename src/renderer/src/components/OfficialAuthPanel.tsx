import React, { useEffect, useState } from 'react'
import { Check, Copy, Globe, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AccountInput, OfficialOAuthStart, Platform } from '@shared/types'
import { hasPkceOAuth, hasQuota } from '@shared/platformFlags'
import { officialLoginUrl } from '@shared/officialLogin'
import { api } from '@renderer/lib/api'
import { platformMeta } from '@renderer/lib/platforms'
import { useAccountsStore } from '@renderer/store/accounts'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'

export function OfficialAuthPanel({
  platform,
  onDone,
  onCreated
}: {
  platform: Platform
  onDone: (input: AccountInput) => void
  onCreated?: () => void
}): React.JSX.Element {
  if (hasPkceOAuth(platform)) return <PkceAuthPanel platform={platform} onDone={onDone} />
  return <BrowserAuthPanel platform={platform} onCreated={onCreated || (() => onDone({ platform, label: platform, username: '', email: '' }))} />
}

function PkceAuthPanel({
  platform,
  onDone
}: {
  platform: Platform
  onDone: (input: AccountInput) => void
}): React.JSX.Element {
  const [session, setSession] = useState<OfficialOAuthStart | null>(null)
  const [status, setStatus] = useState('正在创建授权会话…')
  const [waiting, setWaiting] = useState(false)
  const [callback, setCallback] = useState('')
  const [busy, setBusy] = useState(false)
  const name = platformMeta(platform).label

  useEffect(() => {
    let dead = false
    setSession(null)
    setCallback('')
    setWaiting(false)
    setStatus('正在创建授权会话…')
    void (async () => {
      try {
        const started = await api.oauth.start(platform)
        if (dead) {
          await api.oauth.cancel(started.loginId)
          return
        }
        setSession(started)
        setStatus('等待授权完成…')
        setWaiting(true)
        const input = await api.oauth.wait(started.loginId)
        if (dead || !input) return
        setWaiting(false)
        setStatus('授权成功')
        onDone(input)
      } catch (e) {
        if (dead) return
        setWaiting(false)
        setStatus((e as Error).message)
      }
    })()
    return () => {
      dead = true
      void api.oauth.cancel()
    }
  }, [platform, onDone])

  const openBrowser = async (): Promise<void> => {
    if (!session?.authUrl) return
    await api.oauth.openUrl(session.authUrl)
    toast.success('已在浏览器打开授权页')
  }

  const copyUrl = async (): Promise<void> => {
    if (!session?.authUrl) return
    await navigator.clipboard.writeText(session.authUrl)
    toast.success('授权链接已复制')
  }

  const submit = async (): Promise<void> => {
    if (!session || !callback.trim()) return
    setBusy(true)
    try {
      const input = await api.oauth.submitCallback(session.loginId, callback.trim())
      setWaiting(false)
      setStatus('授权成功')
      onDone(input)
    } catch (e) {
      toast.error((e as Error).message)
      setStatus((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const bindBlocked = /端口|EACCES|EADDRINUSE|回调服务/.test(status)

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        点击下方按钮，在浏览器中完成 {name} 授权登录（Google / GitHub / 官方账号均可）。
      </p>
      <div className="space-y-1.5">
        <Label>授权链接</Label>
        <div className="flex gap-2">
          <Input readOnly value={session?.authUrl || ''} className="font-mono text-xs" />
          <Button type="button" variant="outline" size="icon" onClick={() => void copyUrl()} disabled={!session?.authUrl}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Button type="button" className="w-full" size="lg" onClick={() => void openBrowser()} disabled={!session?.authUrl}>
        <Globe className="h-4 w-4" /> 在浏览器中打开
      </Button>
      {session?.needsCallback && (
        <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
          <Label className="text-sm">授权后把回调地址粘回来</Label>
          <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            <li>点上面「在浏览器中打开」，完成登录授权</li>
            <li>浏览器会跳到一个打不开的 <span className="font-mono">localhost:1455</span> 页面（<b>这是正常的</b>）</li>
            <li>复制该页面地址栏里 <span className="font-mono">http://localhost:1455/...code=...</span> 整段</li>
            <li>粘到下面，点「我已授权，继续」</li>
          </ol>
          <div className="flex gap-2">
            <Input
              value={callback}
              onChange={(e) => setCallback(e.target.value)}
              placeholder="粘贴回调地址或 code，例如：http://localhost:1455/auth/callback?code=ac_…"
              className="font-mono text-xs"
              autoFocus={bindBlocked}
            />
            <Button type="button" onClick={() => void submit()} disabled={busy || !callback.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} 我已授权，继续
            </Button>
          </div>
        </div>
      )}
      <div
        className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
          bindBlocked ? 'border-warning/40 bg-warning/10 text-warning' : 'bg-secondary/40'
        }`}
      >
        {waiting ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span>{status}</span>
      </div>
    </div>
  )
}

function BrowserAuthPanel({
  platform,
  onCreated
}: {
  platform: Platform
  onCreated: () => void
}): React.JSX.Element {
  const create = useAccountsStore((s) => s.create)
  const replace = useAccountsStore((s) => s.replace)
  const [draftId, setDraftId] = useState('')
  const [status, setStatus] = useState('打开官方登录页，用 Google / GitHub / Apple 等授权即可，不必先填账密')
  const [busy, setBusy] = useState(false)
  const name = platformMeta(platform).label
  const url = officialLoginUrl(platform)

  const openLogin = async (): Promise<void> => {
    setBusy(true)
    try {
      let id = draftId
      if (!id) {
        const acc = await create({
          platform,
          label: `${name} 授权中`,
          username: '',
          email: '',
          tags: ['oauth'],
          notes: `官方授权登录（${name}）`,
          oauthProvider: 'oauth'
        })
        id = acc.id
        setDraftId(id)
      }
      const r = await api.automation.launchProfile(id, url)
      if (!r.ok) {
        toast.error(r.message)
        setStatus(r.message)
        return
      }
      setStatus('已打开官方登录页。用 Google / GitHub / Apple / 微软授权完成后，先关掉浏览器，再点「我已登录」')
      toast.success('已打开官方登录页')
    } catch (e) {
      toast.error((e as Error).message)
      setStatus((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const finish = async (): Promise<void> => {
    if (!draftId) {
      toast.error('请先打开官方登录页')
      return
    }
    setBusy(true)
    try {
      let acc = await api.automation.captureSession(draftId)
      if (hasQuota(platform)) {
        acc = await api.automation.refreshQuota(draftId)
      }
      replace(acc)
      setStatus('已抓取登录会话')
      toast.success('授权成功，账号已保存')
      onCreated()
    } catch (e) {
      toast.error((e as Error).message)
      setStatus((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {name} 支持官方页授权登录（Google / GitHub / Apple / 微软 / X 等），不必先填邮箱密码。
      </p>
      <Button type="button" className="w-full" size="lg" onClick={() => void openLogin()} disabled={busy}>
        <Globe className="h-4 w-4" /> 打开官方登录页
      </Button>
      <Button type="button" variant="outline" className="w-full" onClick={() => void finish()} disabled={busy || !draftId}>
        <Check className="h-4 w-4" /> 我已登录，抓取会话
      </Button>
      <div className="flex items-center gap-2 rounded-md border bg-secondary/40 px-3 py-2 text-sm">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4 text-muted-foreground" />}
        <span>{status}</span>
      </div>
    </div>
  )
}
