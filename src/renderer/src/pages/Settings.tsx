import React, { useEffect, useRef, useState } from 'react'
import {
  Chrome,
  Download,
  FolderOpen,
  LockKeyhole,
  RefreshCw,
  Save,
  ScrollText,
  ShieldCheck,
  Upload
} from 'lucide-react'
import { toast } from 'sonner'
import type { AppSettings, ConnectMode } from '@shared/types'
import { useAppStore } from '@renderer/store/app'
import { useAccountsStore } from '@renderer/store/accounts'
import { useLockStore } from '@renderer/store/lock'
import { applyTheme } from '@renderer/lib/theme'
import { api } from '@renderer/lib/api'
import { PasswordPromptDialog } from '@renderer/components/PasswordPromptDialog'
import { UpdateCard } from '@renderer/components/UpdateCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { Badge } from '@renderer/components/ui/badge'
import { Separator } from '@renderer/components/ui/separator'

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'

export default function SettingsPage(): React.JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const chrome = useAppStore((s) => s.chrome)
  const refreshChrome = useAppStore((s) => s.refreshChrome)
  const cryptoOk = useAppStore((s) => s.cryptoOk)
  const reloadAccounts = useAccountsStore((s) => s.load)
  const lockEnabled = useLockStore((s) => s.enabled)
  const autoLockMinutes = useLockStore((s) => s.autoLockMinutes)
  const setupLock = useLockStore((s) => s.setup)
  const disableLock = useLockStore((s) => s.disable)
  const setAutoLock = useLockStore((s) => s.setAuto)

  const [form, setForm] = useState<AppSettings | null>(settings)
  const [exportPwOpen, setExportPwOpen] = useState(false)
  const [importPwOpen, setImportPwOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const [lockSetupOpen, setLockSetupOpen] = useState(false)
  const [lockDisableOpen, setLockDisableOpen] = useState(false)
  const [pendingMinutes, setPendingMinutes] = useState(10)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setForm(settings)
  }, [settings])

  if (!form) return null

  const set = (patch: Partial<AppSettings>): void => setForm((f) => (f ? { ...f, ...patch } : f))

  const save = async (): Promise<void> => {
    await saveSettings(form)
    applyTheme(form.theme)
    toast.success('设置已保存')
  }

  const exportEncrypted = async (pw: string): Promise<void> => {
    const json = await api.accounts.exportEncrypted(pw)
    const path = await api.system.saveFile(`aam-backup-${stamp()}.aam.json`, json)
    if (path) toast.success(`已导出加密备份到 ${path}`)
  }

  const exportPlain = async (): Promise<void> => {
    if (!window.confirm('明文导出不加密，包含密码 / 2FA 等敏感信息，请妥善保管。确认导出？')) return
    const json = await api.accounts.exportAll()
    const path = await api.system.saveFile(`aam-export-${stamp()}.json`, json)
    if (path) toast.success(`已导出明文数据到 ${path}`)
  }

  const exportLogs = async (): Promise<void> => {
    const logs = await api.logs.query({ limit: 5000 })
    const path = await api.system.saveFile(`aam-logs-${stamp()}.json`, JSON.stringify(logs, null, 2))
    if (path) toast.success(`已导出 ${logs.length} 条日志到 ${path}`)
  }

  const doImport = async (json: string, password?: string): Promise<void> => {
    const { imported } = await api.accounts.importJson(json, password)
    await reloadAccounts()
    toast.success(`已导入 ${imported} 个账号`)
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    let encrypted = false
    try {
      encrypted = (JSON.parse(text) as { format?: string }).format === 'aam-enc'
    } catch {
      toast.error('文件不是有效的 JSON 备份')
      return
    }
    if (encrypted) {
      setPendingImport(text)
      setImportPwOpen(true)
      return
    }
    try {
      await doImport(text)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <UpdateCard />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">浏览器与并发</CardTitle>
          <CardDescription>控制 Playwright 如何驱动本地 Chrome，以及同时运行的任务数量。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>最大并发任务数</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={form.maxConcurrency}
                onChange={(e) => set({ maxConcurrency: Math.max(1, Number(e.target.value) || 1) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>操作间隔 slowMo (ms)</Label>
              <Input
                type="number"
                min={0}
                max={2000}
                value={form.slowMo}
                onChange={(e) => set({ slowMo: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label>无头模式 (headless)</Label>
              <p className="text-xs text-muted-foreground">开启后浏览器在后台运行；首次登录建议关闭以便手动过验证。</p>
            </div>
            <Switch checked={form.headless} onCheckedChange={(v) => set({ headless: v })} />
          </div>

          <div className="space-y-1.5">
            <Label>浏览器接入方式</Label>
            <Select value={form.connectMode} onValueChange={(v) => set({ connectMode: v as ConnectMode })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="launch">启动本地 Chrome（每账号独立配置，推荐）</SelectItem>
                <SelectItem value="cdp">连接已运行的 Chrome（CDP）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.connectMode === 'cdp' && (
            <div className="space-y-1.5">
              <Label>CDP 地址</Label>
              <Input
                value={form.cdpEndpoint}
                onChange={(e) => set({ cdpEndpoint: e.target.value })}
                placeholder="http://127.0.0.1:9222"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                需先以 <code>chrome.exe --remote-debugging-port=9222</code> 启动 Chrome。
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Chrome 路径（留空自动探测）</Label>
            <div className="flex gap-2">
              <Input
                value={form.chromePathOverride ?? ''}
                onChange={(e) => set({ chromePathOverride: e.target.value || null })}
                placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                className="flex-1 font-mono text-xs"
              />
              <Button variant="outline" onClick={() => void refreshChrome()}>
                <RefreshCw className="h-4 w-4" /> 检测
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Chrome className="h-3.5 w-3.5" />
              {chrome?.found ? (
                <span className="text-muted-foreground">
                  已找到：<span className="text-foreground">{chrome.path}</span>
                </span>
              ) : (
                <span className="text-destructive">未检测到 Chrome，请手动指定路径</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">安全与数据</CardTitle>
          <CardDescription>凭据加密方式与本地数据说明。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" /> 主密钥保护
            </span>
            <Badge variant={cryptoOk ? 'success' : 'warning'}>
              {cryptoOk ? '系统钥匙串 (safeStorage)' : '降级模式（无系统钥匙串）'}
            </Badge>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            密码、2FA 密钥、备用码、Refresh Token 使用 AES-256-GCM 加密后存储于本地 SQLite；主密钥由操作系统钥匙串封存。
            所有数据仅保存在本机 userData 目录，不会上传任何服务器。
          </p>

          <Separator />
          <div className="space-y-2">
            <Label>数据目录</Label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void api.system.openDataDir()}>
                <FolderOpen className="h-4 w-4" /> 打开数据目录
              </Button>
              <Button variant="outline" size="sm" onClick={() => void api.system.openLogDir()}>
                <FolderOpen className="h-4 w-4" /> 打开日志目录
              </Button>
            </div>
          </div>

          <Separator />
          <div className="space-y-2">
            <Label>备份与恢复</Label>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setExportPwOpen(true)}>
                <Download className="h-4 w-4" /> 导出加密备份
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> 导入备份
              </Button>
              <Button variant="outline" size="sm" onClick={() => void exportLogs()}>
                <ScrollText className="h-4 w-4" /> 导出日志
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => void exportPlain()}
              >
                导出明文（不推荐）
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              加密备份用备份密码（scrypt + AES-256-GCM）加密整库，可安全离机保存；导入时自动识别加密 / 明文格式。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">应用锁</CardTitle>
          <CardDescription>用 PIN 锁定应用并在空闲后自动锁定。这是界面层的防窥保护，不改变本地加密方式。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-primary" /> 状态
            </span>
            <Badge variant={lockEnabled ? 'success' : 'secondary'}>
              {lockEnabled ? '已启用' : '未启用'}
            </Badge>
          </div>
          <div className="space-y-1.5">
            <Label>空闲自动锁定</Label>
            <Select
              value={String(lockEnabled ? autoLockMinutes : pendingMinutes)}
              onValueChange={(v) => {
                const m = Number(v)
                if (lockEnabled) void setAutoLock(m).then(() => toast.success('已更新自动锁定时间'))
                else setPendingMinutes(m)
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">不自动锁定</SelectItem>
                <SelectItem value="5">5 分钟</SelectItem>
                <SelectItem value="10">10 分钟</SelectItem>
                <SelectItem value="15">15 分钟</SelectItem>
                <SelectItem value="30">30 分钟</SelectItem>
                <SelectItem value="60">60 分钟</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            {lockEnabled ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setLockSetupOpen(true)}>
                  修改 PIN
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setLockDisableOpen(true)}
                >
                  停用
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setLockSetupOpen(true)}>
                <LockKeyhole className="h-4 w-4" /> 启用应用锁
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">外观</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label>主题</Label>
            <Select
              value={form.theme}
              onValueChange={(v) => {
                set({ theme: v as AppSettings['theme'] })
                applyTheme(v as AppSettings['theme'])
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">深色</SelectItem>
                <SelectItem value="light">浅色</SelectItem>
                <SelectItem value="system">跟随系统</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label>显示额度说明</Label>
              <p className="text-xs text-muted-foreground">
                额度条下方显示套餐介绍（如「官方免费档」「套餐内 7771 / 40000 ¢」）。账号页工具栏也可切换。
              </p>
            </div>
            <Switch
              checked={form.showQuotaHints !== false}
              onCheckedChange={(v) => {
                set({ showQuotaHints: v })
                void saveSettings({ showQuotaHints: v })
              }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label>后台自动刷新额度</Label>
              <p className="text-xs text-muted-foreground">
                新授权的账号会立即拉一次额度；之后按这个间隔轮询过期的账号，限速执行避免风控。
              </p>
            </div>
            <Select
              value={String(form.quotaAutoRefreshMinutes ?? 30)}
              onValueChange={(v) => {
                set({ quotaAutoRefreshMinutes: Number(v) })
                void saveSettings({ quotaAutoRefreshMinutes: Number(v) })
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">关闭</SelectItem>
                <SelectItem value="15">每 15 分钟</SelectItem>
                <SelectItem value="30">每 30 分钟</SelectItem>
                <SelectItem value="60">每小时</SelectItem>
                <SelectItem value="360">每 6 小时</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save}>
          <Save className="h-4 w-4" /> 保存设置
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void onFileChange(e)}
      />
      <PasswordPromptDialog
        open={exportPwOpen}
        onOpenChange={setExportPwOpen}
        title="设置备份密码"
        description="用于加密整库备份，导入时需要相同密码。请牢记，遗失将无法恢复。"
        submitLabel="导出"
        requireConfirm
        onSubmit={exportEncrypted}
      />
      <PasswordPromptDialog
        open={importPwOpen}
        onOpenChange={setImportPwOpen}
        title="输入备份密码"
        description="该文件为加密备份，请输入导出时设置的密码。"
        submitLabel="导入"
        onSubmit={async (pw) => {
          if (pendingImport) await doImport(pendingImport, pw)
        }}
      />
      <PasswordPromptDialog
        open={lockSetupOpen}
        onOpenChange={setLockSetupOpen}
        title={lockEnabled ? '修改应用锁 PIN' : '设置应用锁 PIN'}
        description="至少 4 位。忘记 PIN 将无法通过界面解锁（只能删除本地数据重置）。"
        submitLabel={lockEnabled ? '保存' : '启用'}
        requireConfirm
        fieldLabel="PIN"
        placeholder="至少 4 位"
        onSubmit={async (pin) => {
          await setupLock(pin, lockEnabled ? autoLockMinutes : pendingMinutes)
          toast.success(lockEnabled ? 'PIN 已更新' : '应用锁已启用')
        }}
      />
      <PasswordPromptDialog
        open={lockDisableOpen}
        onOpenChange={setLockDisableOpen}
        title="停用应用锁"
        description="输入当前 PIN 以停用。"
        submitLabel="停用"
        fieldLabel="PIN"
        placeholder="当前 PIN"
        onSubmit={async (pin) => {
          const ok = await disableLock(pin)
          if (!ok) throw new Error('PIN 不正确')
          toast.success('已停用应用锁')
        }}
      />
    </div>
  )
}
