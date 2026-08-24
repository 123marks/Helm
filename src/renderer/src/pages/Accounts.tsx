import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Captions,
  ChevronDown,
  Columns3,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Globe,
  KeyRound,
  Layers,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Star,
  Trash,
  Trash2,
  Upload,
  Users
} from 'lucide-react'
import { toast } from 'sonner'
import type { Account, AccountInput, AccountStatus, Platform } from '@shared/types'
import { api } from '@renderer/lib/api'
import { toCsv } from '@renderer/lib/csv'
import { randomIdentity } from '@renderer/lib/identity'
import { relativeTime } from '@renderer/lib/utils'
import { hasLocalApply, hasQuota, localApplyLabel, PLATFORMS } from '@renderer/lib/platforms'
import { officialLoginUrl } from '@shared/officialLogin'
import { accountTitle } from '@shared/accountDisplay'
import { useAccountsStore } from '@renderer/store/accounts'
import { useAppStore } from '@renderer/store/app'
import { useTasksStore } from '@renderer/store/tasks'
import { PlatformGlyph } from '@renderer/components/PlatformBadge'
import { AccountStatusBadge } from '@renderer/components/status'
import { MembershipBadge } from '@renderer/components/MembershipBadge'
import { TotpCell } from '@renderer/components/TotpCell'
import { SecretCell } from '@renderer/components/SecretCell'
import { getSecrets, invalidateSecrets } from '@renderer/lib/secretsCache'
import { AccountDialog } from '@renderer/components/AccountDialog'
import { RunAutomationDialog } from '@renderer/components/RunAutomationDialog'
import { PasswordPromptDialog } from '@renderer/components/PasswordPromptDialog'
import { BatchRegisterDialog } from '@renderer/components/BatchRegisterDialog'
import { ImportCsvDialog } from '@renderer/components/ImportCsvDialog'
import { BulkEditDialog, type BulkEditSpec } from '@renderer/components/BulkEditDialog'
import { AccountCard } from '@renderer/components/AccountCard'
import { CloneAccountDialog } from '@renderer/components/CloneAccountDialog'
import { MailPeekDialog } from '@renderer/components/MailPeekDialog'
import { TrashDialog } from '@renderer/components/TrashDialog'
import { EmptyState } from '@renderer/components/ui/empty-state'
import { SkeletonRows } from '@renderer/components/ui/skeleton'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Badge } from '@renderer/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'

export default function Accounts(): React.JSX.Element {
  const accounts = useAccountsStore((s) => s.accounts)
  const loading = useAccountsStore((s) => s.loading)
  const load = useAccountsStore((s) => s.load)
  const remove = useAccountsStore((s) => s.remove)
  const restore = useAccountsStore((s) => s.restore)
  const update = useAccountsStore((s) => s.update)
  const replace = useAccountsStore((s) => s.replace)
  const openDetail = useAppStore((s) => s.openDetail)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const showQuotaHints = useAppStore((s) => s.settings?.showQuotaHints !== false)
  const registerPrefillInboxIds = useAppStore((s) => s.registerPrefillInboxIds)
  const tasks = useTasksStore((s) => s.tasks)
  const activeAccountIds = useMemo(() => {
    const ids = new Set<string>()
    for (const t of tasks) {
      if (t.status === 'running' || t.status === 'queued') ids.add(t.accountId)
    }
    return ids
  }, [tasks])

  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [group, setGroup] = useState<string>('all')
  const [tag, setTag] = useState<string>('all')
  const [favOnly, setFavOnly] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(
    () => (localStorage.getItem('accountsView') as 'list' | 'grid') || 'grid'
  )
  const setView = (v: 'list' | 'grid'): void => {
    setViewMode(v)
    localStorage.setItem('accountsView', v)
  }
  const COL_KEYS = ['password', 'totp', 'phone', 'recovery'] as const
  const COL_LABELS: Record<(typeof COL_KEYS)[number], string> = {
    password: '密码',
    totp: '2FA',
    phone: '手机号',
    recovery: '恢复信息'
  }
  const [cols, setCols] = useState<Record<(typeof COL_KEYS)[number], boolean>>(() => {
    try {
      const raw = localStorage.getItem('aam.accounts.cols')
      if (raw) return { password: true, totp: true, phone: true, recovery: true, ...JSON.parse(raw) }
    } catch {
      /* keep defaults */
    }
    return { password: true, totp: true, phone: true, recovery: true }
  })
  const toggleCol = (k: (typeof COL_KEYS)[number]): void => {
    setCols((prev) => {
      const next = { ...prev, [k]: !prev[k] }
      localStorage.setItem('aam.accounts.cols', JSON.stringify(next))
      return next
    })
  }
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<{ open: boolean; account: Account | null }>({
    open: false,
    account: null
  })
  const [runDialog, setRunDialog] = useState<{ open: boolean; accounts: Account[] }>({
    open: false,
    accounts: []
  })
  const [exportPwOpen, setExportPwOpen] = useState(false)
  const [importPw, setImportPw] = useState<{ open: boolean; text: string }>({ open: false, text: '' })
  const [registerOpen, setRegisterOpen] = useState(false)

  useEffect(() => {
    if (registerPrefillInboxIds.length > 0) setRegisterOpen(true)
  }, [registerPrefillInboxIds])
  const [csvOpen, setCsvOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [cloneTarget, setCloneTarget] = useState<{ open: boolean; account: Account | null }>({
    open: false,
    account: null
  })
  const [mailPeek, setMailPeek] = useState<{ open: boolean; accountId?: string }>({ open: false })
  const [quotaBusy, setQuotaBusy] = useState(false)
  const [syncing, setSyncing] = useState<Set<string>>(new Set())
  const [deletedCount, setDeletedCount] = useState(0)
  const [localCurrent, setLocalCurrent] = useState<Partial<Record<Platform, string>>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const refreshTrash = useCallback(async (): Promise<void> => {
    setDeletedCount((await api.accounts.listDeleted()).length)
  }, [])

  const syncLocal = useCallback(async (): Promise<void> => {
    try {
      const snap = await api.automation.syncLocal()
      setLocalCurrent(snap.current)
      await load()
      if (snap.imported.length) {
        toast.success(`已从本机导入 ${snap.imported.map((a) => a.email || a.label).join('、')}`)
      }
    } catch {
      /* 主进程未就绪时忽略 */
    }
  }, [load])

  useEffect(() => {
    void refreshTrash()
  }, [refreshTrash])

  useEffect(() => {
    void syncLocal()
  }, [syncLocal])

  const groups = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.groupName).filter(Boolean))).sort(),
    [accounts]
  )

  const tags = useMemo(
    () => Array.from(new Set(accounts.flatMap((a) => a.tags).filter(Boolean))).sort(),
    [accounts]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accounts.filter((a) => {
      if (favOnly && !a.favorite) return false
      if (platform !== 'all' && a.platform !== platform) return false
      if (group !== 'all' && a.groupName !== group) return false
      if (tag !== 'all' && !a.tags.includes(tag)) return false
      if (!q) return true
      return (
        a.label.toLowerCase().includes(q) ||
        a.username.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.groupName.toLowerCase().includes(q) ||
        a.tags.join(' ').toLowerCase().includes(q)
      )
    })
  }, [accounts, search, platform, group, tag, favOnly])

  const toggleFavorite = async (a: Account): Promise<void> => {
    await update(a.id, { favorite: !a.favorite })
  }

  const selectedAccounts = accounts.filter((a) => selected.has(a.id))
  const selectedPlatforms = new Set(selectedAccounts.map((a) => a.platform))
  const canBulkRun = selectedAccounts.length > 0 && selectedPlatforms.size === 1

  const toggle = (id: string): void =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = (): void => {
    if (filtered.every((a) => selected.has(a.id))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((a) => a.id)))
    }
  }

  const copyPassword = async (a: Account): Promise<void> => {
    const s = await api.accounts.reveal(a.id)
    if (!s.password) {
      toast.error('该账号未设置密码')
      return
    }
    await navigator.clipboard.writeText(s.password)
    toast.success('密码已复制')
  }

  const copyTotp = async (a: Account): Promise<void> => {
    const r = await api.totp.get(a.id)
    if (!r) {
      toast.error('该账号未设置 2FA')
      return
    }
    await navigator.clipboard.writeText(r.code)
    toast.success('验证码已复制')
  }

  const copySelected = async (): Promise<void> => {
    const rows = ['平台\t标签\t邮箱\t用户名\t密码\t2FA']
    for (const a of selectedAccounts) {
      const s = await api.accounts.reveal(a.id)
      let totp = ''
      if (a.hasTotp) totp = (await api.totp.get(a.id))?.code ?? ''
      rows.push([a.platform, a.label, a.email, a.username, s.password ?? '', totp].join('\t'))
    }
    await navigator.clipboard.writeText(rows.join('\n'))
    toast.success(`已复制 ${selectedAccounts.length} 个账号信息`)
  }

  const exportSelected = async (): Promise<void> => {
    const json = await api.accounts.exportSelected(selectedAccounts.map((a) => a.id))
    downloadText(json, `accounts-selected-${Date.now()}.json`)
    toast.warning(`已导出 ${selectedAccounts.length} 个账号（明文，请妥善保管）`)
  }

  const applyLocal = async (a: Account): Promise<void> => {
    try {
      const r = await api.automation.applyLocal(a.id)
      if (r.ok) {
        toast.success(r.message)
        await syncLocal()
      } else toast.error(r.message)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const launchBrowser = async (a: Account, url?: string): Promise<void> => {
    const r = await api.automation.launchProfile(a.id, url)
    if (r.ok) toast.success(r.message)
    else toast.error(r.message)
  }

  const refreshQuota = async (a: Account): Promise<void> => {
    try {
      const next = await api.automation.refreshQuota(a.id)
      replace(next)
      if (next.quota?.error) toast.error(next.quota.error)
      else toast.success(next.quota?.plan ? `额度：${next.quota.plan}` : '额度已刷新')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const refreshQuotaBatch = async (ids: string[], label: string): Promise<void> => {
    const unique = [...new Set(ids)]
    if (unique.length === 0) {
      toast.error('没有可查询额度的账号')
      return
    }
    if (quotaBusy) {
      toast.error('额度查询正在进行')
      return
    }
    setQuotaBusy(true)
    toast.loading(`${label}：0 / ${unique.length}（主号优先，限速防风控）`, { id: 'quota-batch' })
    try {
      const rows = await api.automation.refreshQuotas(unique)
      rows.forEach(replace)
      const failed = rows.filter((a) => a.quota?.error).length
      if (failed) toast.warning(`已刷新 ${rows.length} 个，其中 ${failed} 个失败`, { id: 'quota-batch' })
      else toast.success(`已刷新 ${rows.length} 个额度`, { id: 'quota-batch' })
    } catch (e) {
      toast.error((e as Error).message, { id: 'quota-batch' })
    } finally {
      setQuotaBusy(false)
    }
  }

  useEffect(() => {
    return api.automation.onQuotaUpdated((e) => {
      if (e.account) replace(e.account)
      setSyncing((prev) => {
        const next = new Set(prev)
        if (e.phase === 'start') next.add(e.accountId)
        else next.delete(e.accountId)
        return next
      })
      if (e.reason === 'batch' && e.phase === 'done') {
        toast.loading(`额度查询 ${e.done} / ${e.total}`, { id: 'quota-batch' })
      }
    })
  }, [replace])

  const bulkStatus = async (status: AccountStatus): Promise<void> => {
    const list = selectedAccounts
    for (const a of list) await update(a.id, { status })
    toast.success(`已更新 ${list.length} 个账号状态`)
  }

  const applyBulkEdit = async (spec: BulkEditSpec): Promise<void> => {
    const list = selectedAccounts
    for (const a of list) {
      const patch: Partial<AccountInput> = {}
      if (spec.setGroup) patch.groupName = spec.group
      if (spec.setProxy) patch.proxyUrl = spec.proxy
      if (spec.setStatus) patch.status = spec.status
      if (spec.tagsMode === 'replace') patch.tags = spec.tags
      else if (spec.tagsMode === 'append') patch.tags = Array.from(new Set([...a.tags, ...spec.tags]))
      if (spec.randomizeIdentity) {
        const id = randomIdentity()
        patch.userAgent = id.userAgent
        patch.locale = id.locale
        patch.timezone = id.timezone
      }
      if (Object.keys(patch).length > 0) await update(a.id, patch)
    }
    toast.success(`已更新 ${list.length} 个账号`)
  }

  const bulkFavorite = async (favorite: boolean): Promise<void> => {
    const list = selectedAccounts
    for (const a of list) await update(a.id, { favorite })
    toast.success(favorite ? `已标为主号 ${list.length} 个` : `已取消主号 ${list.length} 个`)
  }

  const bulkDelete = async (): Promise<void> => {
    const ids = selectedAccounts.map((a) => a.id)
    if (ids.length === 0) return
    for (const id of ids) await remove(id)
    setSelected(new Set())
    void refreshTrash()
    toast(`已移至回收站 ${ids.length} 个账号`, {
      action: {
        label: '全部撤销',
        onClick: () => {
          void (async () => {
            for (const id of ids) await restore(id)
            void refreshTrash()
          })()
        }
      }
    })
  }

  const onDelete = async (a: Account): Promise<void> => {
    await remove(a.id)
    setSelected((s) => {
      const next = new Set(s)
      next.delete(a.id)
      return next
    })
    void refreshTrash()
    toast(`已将「${a.label}」移至回收站`, {
      action: {
        label: '撤销',
        onClick: () => {
          void (async () => {
            await restore(a.id)
            void refreshTrash()
          })()
        }
      }
    })
  }

  const downloadText = (text: string, filename: string): void => {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const doExportPlain = async (): Promise<void> => {
    const json = await api.accounts.exportAll()
    downloadText(json, `accounts-plain-${Date.now()}.json`)
    toast.warning('明文导出包含未加密凭据，请妥善保管')
  }

  const doExportCsv = async (): Promise<void> => {
    const json = await api.accounts.exportAll()
    const data = JSON.parse(json) as {
      accounts: Array<{
        label?: string
        platform?: string
        username?: string
        email?: string
        password?: string | null
        totpSecret?: string | null
        notes?: string
        groupName?: string
        tags?: string[]
      }>
    }
    const rows = data.accounts.map((a) => ({
      name: a.label ?? '',
      platform: a.platform ?? '',
      username: a.username ?? '',
      email: a.email ?? '',
      password: a.password ?? '',
      totp: a.totpSecret ?? '',
      notes: a.notes ?? '',
      folder: a.groupName ?? '',
      tags: (a.tags ?? []).join('|')
    }))
    const csv = toCsv(
      ['name', 'platform', 'username', 'email', 'password', 'totp', 'notes', 'folder', 'tags'],
      rows
    )
    downloadText(csv, `accounts-${Date.now()}.csv`)
    toast.warning(`已导出 ${rows.length} 个账号为 CSV（明文，请妥善保管）`)
  }

  const doExportEncrypted = async (password: string): Promise<void> => {
    const json = await api.accounts.exportEncrypted(password)
    downloadText(json, `aam-backup-${Date.now()}.json`)
    toast.success('已导出加密备份')
  }

  const doImport = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    if (fileRef.current) fileRef.current.value = ''

    let encrypted = false
    try {
      encrypted = (JSON.parse(text) as { format?: string })?.format === 'aam-enc'
    } catch {
      encrypted = false
    }
    if (encrypted) {
      setImportPw({ open: true, text })
      return
    }

    try {
      const { imported } = await api.accounts.importJson(text)
      await load()
      toast.success(`已导入 ${imported} 个账号`)
    } catch (err) {
      toast.error('导入失败: ' + (err as Error).message)
    }
  }

  const doImportEncrypted = async (password: string): Promise<void> => {
    const { imported } = await api.accounts.importJson(importPw.text, password)
    await load()
    toast.success(`已导入 ${imported} 个账号`)
  }

  const recoveryTags = (a: Account): React.JSX.Element => (
    <div className="flex flex-wrap gap-1">
      {a.recoveryEmail && <Badge variant="outline">邮</Badge>}
      {a.recoveryPhone && <Badge variant="outline">机</Badge>}
      {a.hasBackupCodes && <Badge variant="outline">码</Badge>}
      {a.hasRefreshToken && <Badge variant="outline">RT</Badge>}
      {!a.recoveryEmail && !a.recoveryPhone && !a.hasBackupCodes && !a.hasRefreshToken && (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标签 / 用户名 / 邮箱 / 分组"
            className="pl-9"
          />
        </div>
        <div className="flex items-center rounded-lg border p-0.5">
          <button
            onClick={() => setView('grid')}
            title="卡片视图"
            aria-label="卡片视图"
            aria-pressed={viewMode === 'grid'}
            className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              viewMode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView('list')}
            title="列表视图"
            aria-label="列表视图"
            aria-pressed={viewMode === 'list'}
            className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          title={showQuotaHints ? '隐藏额度说明' : '显示额度说明'}
          aria-label={showQuotaHints ? '隐藏额度说明' : '显示额度说明'}
          aria-pressed={showQuotaHints}
          onClick={() => void saveSettings({ showQuotaHints: !showQuotaHints })}
          className={`rounded-lg border p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            showQuotaHints ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Captions className="h-4 w-4" />
        </button>
        {viewMode === 'list' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" title="列显示">
                <Columns3 className="h-4 w-4" /> 列
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {COL_KEYS.map((k) => (
                <DropdownMenuItem
                  key={k}
                  onSelect={(e) => {
                    e.preventDefault()
                    toggleCol(k)
                  }}
                >
                  <Checkbox checked={cols[k]} className="mr-2" />
                  {COL_LABELS[k]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Select value={platform} onValueChange={(v) => setPlatform(v as Platform | 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部平台</SelectItem>
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
        {groups.length > 0 && (
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分组</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {tags.length > 0 && (
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部标签</SelectItem>
              {tags.map((tg) => (
                <SelectItem key={tg} value={tg}>
                  {tg}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {viewMode === 'grid' && filtered.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={filtered.length > 0 && filtered.every((a) => selected.has(a.id))}
              onCheckedChange={toggleAll}
            />
            全选当前
          </label>
        )}
        <button
          onClick={() => setFavOnly((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
            favOnly
              ? 'border-warning/40 bg-warning/15 text-warning'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
          title="只看收藏"
        >
          <Star className={`h-3.5 w-3.5 ${favOnly ? 'fill-current' : ''}`} /> 收藏
        </button>
        <div className="flex-1" />
        <input ref={fileRef} type="file" accept="application/json,.aam" className="hidden" onChange={doImport} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Upload className="h-4 w-4" /> 导入 <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onClick={() => fileRef.current?.click()}>
              <FileText className="h-4 w-4" />
              <div>
                <div>导入备份</div>
                <div className="text-xs text-muted-foreground">本工具导出的 JSON / 加密 .aam</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCsvOpen(true)}>
              <FileSpreadsheet className="h-4 w-4" />
              <div>
                <div>从 CSV 导入</div>
                <div className="text-xs text-muted-foreground">Chrome / Edge / Bitwarden / 1Password / KeePass</div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Download className="h-4 w-4" /> 备份导出 <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => setExportPwOpen(true)}>
              <Lock className="h-4 w-4" />
              <div>
                <div>加密备份（推荐）</div>
                <div className="text-xs text-muted-foreground">用密码加密，安全存档</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void doExportPlain()}>
              <FileText className="h-4 w-4" />
              <div>
                <div>明文导出</div>
                <div className="text-xs text-muted-foreground">不加密，含明文凭据</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void doExportCsv()}>
              <FileSpreadsheet className="h-4 w-4" />
              <div>
                <div>导出 CSV（明文）</div>
                <div className="text-xs text-muted-foreground">与浏览器 / 密码管理器互通</div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" onClick={() => setTrashOpen(true)} title="回收站">
          <Trash className="h-4 w-4" /> 回收站
          {deletedCount > 0 && (
            <Badge variant="secondary" className="ml-1">
              {deletedCount}
            </Badge>
          )}
        </Button>
        <Button
          variant="outline"
          disabled={quotaBusy}
          title="查询全部有订阅额度的账号：主号优先，同域名限速，避免风控"
          onClick={() =>
            void refreshQuotaBatch(
              accounts.filter((a) => hasQuota(a.platform)).map((a) => a.id),
              '刷新全部额度'
            )
          }
        >
          <RefreshCw className={`h-4 w-4 ${quotaBusy ? 'animate-spin' : ''}`} /> 刷新全部额度
        </Button>
        <Button variant="outline" onClick={() => setRegisterOpen(true)}>
          <Rocket className="h-4 w-4" /> 批量注册
        </Button>
        <Button onClick={() => setDialog({ open: true, account: null })}>
          <Plus className="h-4 w-4" /> 新增账号
        </Button>
      </div>

      {selected.size === 0 && (
        <p className="text-xs text-muted-foreground">
          勾选卡片后可批量删除、标主号、改状态、导出。转动彩虹边框只出现在执行中的账号；金色边框表示主号。
        </p>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2.5">
          <span className="text-sm">
            已选 <span className="font-semibold">{selected.size}</span> 个账号
          </span>
          <Button
            size="sm"
            disabled={!canBulkRun}
            onClick={() => setRunDialog({ open: true, accounts: selectedAccounts })}
          >
            <Play className="h-4 w-4" /> 批量运行自动化
          </Button>
          {!canBulkRun && (
            <span className="text-xs text-muted-foreground">（批量运行需选择同一平台的账号）</span>
          )}
          <Button size="sm" variant="outline" onClick={() => void copySelected()}>
            <Copy className="h-4 w-4" /> 复制所选
          </Button>
          <Button size="sm" variant="outline" onClick={() => void exportSelected()}>
            <Download className="h-4 w-4" /> 导出所选
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={quotaBusy}
            onClick={() =>
              void refreshQuotaBatch(
                selectedAccounts.filter((a) => hasQuota(a.platform)).map((a) => a.id),
                '刷新所选额度'
              )
            }
          >
            <RefreshCw className={`h-4 w-4 ${quotaBusy ? 'animate-spin' : ''}`} /> 刷新额度
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>
            <Layers className="h-4 w-4" /> 批量编辑
          </Button>
          <Button size="sm" variant="outline" onClick={() => void bulkFavorite(true)}>
            <Star className="h-4 w-4" /> 标为主号
          </Button>
          <Button size="sm" variant="outline" onClick={() => void bulkFavorite(false)}>
            取消主号
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                设为状态 <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => void bulkStatus('active')}>正常</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void bulkStatus('disabled')}>停用</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void bulkStatus('error')}>异常</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="destructive" onClick={() => void bulkDelete()}>
            <Trash2 className="h-4 w-4" /> 批量删除
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            清除选择
          </Button>
        </div>
      )}

      {loading && accounts.length === 0 ? (
        <div className="rounded-xl border bg-card p-4">
          <SkeletonRows rows={6} />
        </div>
      ) : viewMode === 'grid' ? (
        filtered.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <EmptyState
              icon={Users}
              title="没有匹配的账号"
              description="调整筛选条件，或点击右上角「新增账号」开始。"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 [grid-auto-rows:1fr] sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                running={activeAccountIds.has(a.id)}
                syncing={syncing.has(a.id)}
                current={localCurrent[a.platform] === a.id}
                selected={selected.has(a.id)}
                onToggleSelect={() => toggle(a.id)}
                onOpenDetail={() => openDetail(a.id)}
                onToggleFavorite={() => void toggleFavorite(a)}
                onEdit={() => setDialog({ open: true, account: a })}
                onRun={() => setRunDialog({ open: true, accounts: [a] })}
                onApplyLocal={() => void applyLocal(a)}
                onLaunch={() => void launchBrowser(a)}
                onAuthLogin={() => void launchBrowser(a, officialLoginUrl(a.platform))}
                onCopyPassword={() => void copyPassword(a)}
                onCopyTotp={() => void copyTotp(a)}
                onCopyRecovery={() => {
                  const t = a.recoveryEmail || a.recoveryPhone
                  if (!t) return
                  void navigator.clipboard.writeText(t)
                  toast.success('恢复信息已复制')
                }}
                onEditProxy={() => setDialog({ open: true, account: a })}
                onPeekMail={() => setMailPeek({ open: true, accountId: a.id })}
                onRefreshQuota={() => refreshQuota(a)}
                onDelete={() => void onDelete(a)}
              />
            ))}
          </div>
        )
      ) : (
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={filtered.length > 0 && filtered.every((a) => selected.has(a.id))}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead>平台</TableHead>
              <TableHead>账号</TableHead>
              {cols.password && <TableHead className="w-[140px]">密码</TableHead>}
              {cols.totp && <TableHead>2FA 验证码</TableHead>}
              {cols.phone && <TableHead className="w-[150px]">手机号</TableHead>}
              {cols.recovery && <TableHead>恢复信息</TableHead>}
              <TableHead>状态</TableHead>
              <TableHead>最近使用</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-14 text-center text-sm text-muted-foreground">
                  没有匹配的账号。点击右上角「新增账号」开始。
                </TableCell>
              </TableRow>
            )}
            {filtered.map((a) => (
              <TableRow key={a.id} data-state={selected.has(a.id) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <PlatformGlyph platform={a.platform} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void toggleFavorite(a)}
                      title={a.favorite ? '取消收藏' : '收藏'}
                      className="shrink-0 text-muted-foreground/40 transition-colors hover:text-warning"
                    >
                      <Star className={`h-4 w-4 ${a.favorite ? 'fill-warning text-warning' : ''}`} />
                    </button>
                    <button
                      className="group/detail text-left"
                      onClick={() => openDetail(a.id)}
                      title="查看详情"
                    >
                      <div className="flex items-center gap-1.5 font-medium group-hover/detail:text-primary group-hover/detail:underline">
                        {accountTitle(a)}
                        {hasQuota(a.platform) && <MembershipBadge platform={a.platform} quota={a.quota} />}
                        {localCurrent[a.platform] === a.id && (
                          <Badge className="h-5 bg-emerald-500/20 px-1.5 text-[10px] text-emerald-300">
                            当前使用
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{a.email || a.username || '—'}</div>
                    </button>
                  </div>
                </TableCell>
                {cols.password && (
                  <TableCell>
                    <SecretCell
                      value={null}
                      load={async () => (await getSecrets(a.id)).password}
                      copyLabel="密码已复制"
                      onEdit={async (next) => {
                        await api.accounts.update(a.id, { password: next })
                        invalidateSecrets(a.id)
                        await load()
                      }}
                    />
                  </TableCell>
                )}
                {cols.totp && (
                  <TableCell>
                    <TotpCell
                      accountId={a.id}
                      hasTotp={a.hasTotp}
                      onEditSecret={() => setDialog({ open: true, account: a })}
                    />
                  </TableCell>
                )}
                {cols.phone && (
                  <TableCell>
                    <SecretCell
                      value={a.recoveryPhone || null}
                      mask="partial"
                      copyLabel="手机号已复制"
                      onEdit={async (next) => {
                        await api.accounts.update(a.id, { recoveryPhone: next })
                        await load()
                      }}
                    />
                  </TableCell>
                )}
                {cols.recovery && (
                  <TableCell>
                    <SecretCell
                      value={a.recoveryEmail || null}
                      mask="partial"
                      copyLabel="恢复邮箱已复制"
                      onEdit={async (next) => {
                        await api.accounts.update(a.id, { recoveryEmail: next })
                        await load()
                      }}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <AccountStatusBadge status={a.status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{relativeTime(a.lastUsedAt)}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="账号操作" title="更多操作">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setDialog({ open: true, account: a })}>
                        <Pencil className="h-4 w-4" /> 编辑
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setCloneTarget({ open: true, account: a })}>
                        <Copy className="h-4 w-4" /> 克隆账号
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void copyPassword(a)}>
                        <KeyRound className="h-4 w-4" /> 复制密码
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void copyTotp(a)}>
                        <Copy className="h-4 w-4" /> 复制验证码
                      </DropdownMenuItem>
                      {hasLocalApply(a.platform) && (
                        <DropdownMenuItem onClick={() => void applyLocal(a)}>
                          <Play className="h-4 w-4" /> 应用到本地 {localApplyLabel(a.platform)}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setRunDialog({ open: true, accounts: [a] })}>
                        <Play className="h-4 w-4" /> 运行自动化
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void launchBrowser(a)}>
                        <Globe className="h-4 w-4" /> 打开浏览器
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void api.system.revealProfile(a.id)}>
                        <FolderOpen className="h-4 w-4" /> 打开配置目录
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => void onDelete(a)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" /> 删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      )}

      <AccountDialog
        open={dialog.open}
        account={dialog.account}
        onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))}
      />
      <RunAutomationDialog
        open={runDialog.open}
        accounts={runDialog.accounts}
        onOpenChange={(v) => setRunDialog((d) => ({ ...d, open: v }))}
      />
      <PasswordPromptDialog
        open={exportPwOpen}
        onOpenChange={setExportPwOpen}
        title="加密备份导出"
        description="设置一个备份密码；恢复时需要用它解密。请牢记，无法找回。"
        submitLabel="导出"
        requireConfirm
        onSubmit={doExportEncrypted}
      />
      <PasswordPromptDialog
        open={importPw.open}
        onOpenChange={(v) => setImportPw((s) => ({ ...s, open: v }))}
        title="导入加密备份"
        description="该文件是加密备份，请输入导出时设置的备份密码。"
        submitLabel="导入"
        onSubmit={doImportEncrypted}
      />
      <BatchRegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} />
      <ImportCsvDialog open={csvOpen} onOpenChange={setCsvOpen} onDone={() => void load()} />
      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        count={selected.size}
        onApply={applyBulkEdit}
      />
      <TrashDialog
        open={trashOpen}
        onOpenChange={(v) => {
          setTrashOpen(v)
          if (!v) void refreshTrash()
        }}
        onChanged={() => {
          void load()
          void refreshTrash()
        }}
      />
      <CloneAccountDialog
        open={cloneTarget.open}
        account={cloneTarget.account}
        onOpenChange={(v) => setCloneTarget((c) => ({ ...c, open: v }))}
        onDone={() => void load()}
      />
      <MailPeekDialog
        open={mailPeek.open}
        accountId={mailPeek.accountId}
        onOpenChange={(v) => setMailPeek((s) => ({ ...s, open: v }))}
      />
    </div>
  )
}
