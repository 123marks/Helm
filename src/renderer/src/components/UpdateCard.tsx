import React, { useEffect, useState } from 'react'
import { Download, RefreshCw, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import type { UpdateStatus } from '@shared/types'
import { api } from '@renderer/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'

function statusText(s: UpdateStatus): string {
  switch (s.state) {
    case 'idle':
      return '启动后会自动检查 GitHub Releases。'
    case 'disabled':
      return s.message
    case 'checking':
      return '正在检查 GitHub 最新版本…'
    case 'available':
      return `发现新版本 v${s.version}，正在后台下载。`
    case 'not-available':
      return `已是最新版 v${s.version}。`
    case 'downloading':
      return `正在下载 ${s.percent.toFixed(0)}%`
    case 'downloaded':
      return `v${s.version} 已下载完成，重启即可安装。`
    case 'error':
      return s.message
  }
}

export function UpdateCard(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.updater.status().then(setStatus)
    return api.updater.onChanged(setStatus)
  }, [])

  const check = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await api.updater.check()
      setStatus(next)
      if (next.state === 'not-available') toast.success(`已是最新版 v${next.version}`)
      if (next.state === 'available') toast.message(`发现 v${next.version}，开始下载`)
      if (next.state === 'disabled') toast.message(next.message)
      if (next.state === 'error') toast.error(next.message)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">应用更新</CardTitle>
        <CardDescription>
          与 Cockpit 相同：GitHub 打 tag 发版后，已安装用户会自动收到更新。当前 v{__APP_VERSION__}。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{statusText(status)}</p>
        {status.state === 'downloading' && <Progress value={Math.max(1, Math.min(100, status.percent))} />}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void check()} disabled={busy || status.state === 'checking'}>
            <RefreshCw className={`h-4 w-4 ${busy || status.state === 'checking' ? 'animate-spin' : ''}`} />
            检查更新
          </Button>
          {status.state === 'available' && (
            <Button size="sm" variant="outline" onClick={() => void api.updater.download()}>
              <Download className="h-4 w-4" /> 立即下载
            </Button>
          )}
          {status.state === 'downloaded' && (
            <Button size="sm" onClick={() => void api.updater.install()}>
              <Rocket className="h-4 w-4" /> 重启并安装
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open('https://github.com/123marks/Helm/releases', '_blank')}
          >
            打开 Releases
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
