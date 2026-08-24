// Shared domain types used by both the main process and the renderer.
// Keep this file free of any Node/Electron/DOM specific imports.

export type Platform =
  | 'google'
  | 'github'
  | 'microsoft'
  | 'apple'
  | 'x'
  | 'youtube'
  | 'discord'
  | 'openai'
  | 'anthropic'
  | 'cursor'
  | 'windsurf'
  | 'kiro'
  | 'grok'
  | 'antigravity'
  | 'custom'

export type PlanKind =
  | 'free'
  | 'lite'
  | 'go'
  | 'plus'
  | 'pro'
  | 'pro_plus'
  | 'pro_max'
  | 'max'
  | 'ultra'
  | 'power'
  | 'team'
  | 'enterprise'
  | 'unknown'

/**
 * Well-known meters get a stable id so the UI can order them; platforms that
 * expose per-model quota (Antigravity) mint ids like `model:gemini-3-pro:5h`.
 */
export type QuotaMeterId =
  | 'included'
  | 'premium'
  | 'ondemand'
  | 'weekly'
  | 'api'
  | 'claude_5h'
  | 'claude_week'
  | 'gemini_5h'
  | 'gemini_week'
  | 'credits'
  | (string & {})

/** One quota pool. Never merge 基础 and 高级 into a single used/limit. */
export interface QuotaMeter {
  id: QuotaMeterId
  label: string
  used: number | null
  limit: number | null
  unit: string
  resetAt: number | null
  unlimited?: boolean
  /** Absolute figures behind the percentage, e.g. `$90.36 / $400.00`. */
  note?: string
  /** Longer explanation, hidden when the user turns quota hints off. */
  hint?: string
  /** Optional column this meter belongs to, e.g. `claude` / `gemini`. */
  group?: string
  /** Per-model rows are hidden behind a toggle so cards stay compact. */
  detail?: boolean
  /** A status line rather than a pool: always shown, rendered without a bar. */
  info?: boolean
}

export type AccountStatus = 'active' | 'disabled' | 'error'

/** Account as exposed to the renderer. Secrets are NEVER included here. */
export interface Account {
  id: string
  platform: Platform
  label: string
  username: string
  email: string
  hasPassword: boolean
  hasTotp: boolean
  recoveryEmail: string
  recoveryPhone: string
  hasBackupCodes: boolean
  hasRefreshToken: boolean
  customFields: Record<string, string>
  groupName: string
  tags: string[]
  status: AccountStatus
  favorite: boolean
  profileDir: string
  proxyUrl: string
  /** Per-profile browser identity (anti-detect): overrides for the isolated Chrome. */
  userAgent: string
  locale: string
  timezone: string
  notes: string
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
  /** OAuth 注册来源平台（google / github），空表示非 OAuth。 */
  oauthProvider: string
  /** 授权源账号 id。 */
  oauthSourceAccountId: string
  /** How this account receives mail: gmail_app / icloud_app / outlook_app / outlook_graph. */
  mailboxKind: string
  mailboxClientId: string
  hasMailboxPass: boolean
  quota: AccountQuota | null
}

export interface AccountQuota {
  plan: string
  planKind?: PlanKind
  loginMethod?: string
  /** Primary = 基础额度 only. Do not store 基础+高级合计. */
  used: number | null
  limit: number | null
  unit: string
  resetAt: number | null
  meters?: QuotaMeter[]
  expiresAt?: number | null
  email?: string
  /** Which client the quota belongs to, e.g. `Antigravity IDE`. */
  surface?: string
  error: string
  fetchedAt: number
}

/**
 * Progress of a quota fetch pushed from the main process.
 * `batch` = user pressed refresh, `auto` = right after a new account was saved,
 * `sweep` = background staleness poll.
 */
export interface QuotaSyncEvent {
  accountId: string
  reason: 'batch' | 'auto' | 'sweep'
  phase: 'start' | 'done' | 'error'
  account?: Account
  message?: string
  done?: number
  total?: number
}

/** Official browser OAuth session (Cursor poll / OpenAI·Kiro·Windsurf localhost callback). */
export interface OfficialOAuthStart {
  loginId: string
  platform: Platform
  authUrl: string
  expiresIn: number
  intervalSeconds: number
  needsCallback: boolean
}

/** A previous password (masked preview + timestamp); plaintext fetched on demand. */
export interface PasswordHistoryEntry {
  id: number
  changedAt: number
  preview: string
}

/** Decrypted secrets, only returned on an explicit, single reveal call. */
export interface AccountSecrets {
  password: string | null
  totpSecret: string | null
  backupCodes: string[]
  refreshToken: string | null
  mailboxAppPassword: string | null
}

/** Payload for creating/updating an account. */
export interface AccountInput {
  platform: Platform
  label: string
  username: string
  email: string
  password?: string | null
  totpSecret?: string | null
  recoveryEmail?: string
  recoveryPhone?: string
  backupCodes?: string[]
  refreshToken?: string | null
  customFields?: Record<string, string>
  groupName?: string
  tags?: string[]
  status?: AccountStatus
  favorite?: boolean
  proxyUrl?: string
  userAgent?: string
  locale?: string
  timezone?: string
  notes?: string
  oauthProvider?: string
  oauthSourceAccountId?: string
  mailboxKind?: string
  mailboxAppPassword?: string | null
  mailboxClientId?: string
  quota?: AccountQuota | null
}

export type TaskType =
  | 'check_login'
  | 'change_password'
  | 'change_recovery'
  | 'manage_2fa'
  | 'register'
  | 'register_oauth'
  | 'change_phone'
  | 'enable_2fa'
  | 'rotate_2fa'
  | 'fetch_backup_codes'

export type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled'

export interface AutomationTask {
  id: string
  accountId: string
  accountLabel: string
  platform: Platform
  type: TaskType
  status: TaskStatus
  params: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  progress: number
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export interface EnqueueRequest {
  accountIds: string[]
  type: TaskType
  params: Record<string, unknown>
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  ts: number
  level: LogLevel
  category: string
  accountId: string | null
  taskId: string | null
  message: string
  meta: Record<string, unknown> | null
}

export interface LogFilter {
  level?: LogLevel
  category?: string
  accountId?: string
  taskId?: string
  search?: string
  limit?: number
}

export interface TotpResult {
  code: string
  remainingSeconds: number
  period: number
  digits: number
}

export interface TotpParseResult {
  secret: string
  issuer?: string
  label?: string
  digits: number
  period: number
}

export type SecurityIssueKind =
  | 'no_password'
  | 'weak_password'
  | 'reused_password'
  | 'no_2fa'
  | 'no_recovery'
  | 'stale_password'

export interface AccountAudit {
  accountId: string
  label: string
  platform: Platform
  hasPassword: boolean
  passwordStrength: number // 0..100 (0 when no password)
  issues: SecurityIssueKind[]
  reusedWith: string[] // labels of other accounts sharing this password
  passwordUpdatedAt: number | null
}

export interface BreachResult {
  accountId: string
  count: number // times this password appeared in known breaches (HaveIBeenPwned)
}

export interface SecurityReport {
  generatedAt: number
  score: number // 0..100 overall health
  totals: {
    accounts: number
    noPassword: number
    weakPassword: number
    reusedPassword: number
    no2fa: number
    noRecovery: number
    stalePassword: number
  }
  accounts: AccountAudit[]
}

export type ActionParamType = 'text' | 'password' | 'boolean' | 'select'

export interface ActionParam {
  key: string
  label: string
  type: ActionParamType
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
  help?: string
  defaultValue?: string | boolean
}

export interface AutomationActionDescriptor {
  platform: Platform
  action: TaskType
  title: string
  description: string
  params: ActionParam[]
}

import type { ProviderType } from './providers'

/** A user-configured instance of a provider driver (secrets encrypted at rest). */
export interface ProviderSetting {
  id: string
  type: ProviderType
  driver: string
  name: string
  enabled: boolean
  isDefault: boolean
  config: Record<string, string | number | boolean>
  createdAt: number
  updatedAt: number
}

export interface ProviderSettingInput {
  type: ProviderType
  driver: string
  name: string
  enabled?: boolean
  isDefault?: boolean
  config?: Record<string, string | number | boolean>
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  detail?: string
}

/** Recent inbox preview sent to the renderer (body truncated, no credentials). */
export interface MailPreview {
  id: string
  subject: string
  from: string
  to?: string
  text: string
  receivedAt: number
}

export type ConnectMode = 'launch' | 'cdp'

export interface AppSettings {
  maxConcurrency: number
  headless: boolean
  chromePathOverride: string | null
  connectMode: ConnectMode
  cdpEndpoint: string
  language: 'zh' | 'en'
  theme: 'light' | 'dark' | 'system'
  /** 额度条下方的官方说明（套餐内用量 / 免费档限制等） */
  showQuotaHints: boolean
  /** 后台轮询所有账号额度的间隔，单位分钟；0 表示关闭。 */
  quotaAutoRefreshMinutes: number
  slowMo: number
  skipUpdateVersion: string
}

export interface LocalApplyResult {
  ok: boolean
  targets: string[]
  running: string[]
  message: string
}

export interface LocalLoginSnapshot {
  current: Partial<Record<Platform, string>>
  running: Partial<Record<Platform, boolean>>
  imported: Account[]
  unmatched: { platform: Platform; email: string; source: string }[]
}

export interface ChromeInfo {
  found: boolean
  path: string | null
  source: 'auto' | 'override'
  version: string | null
}

/** The typed surface exposed to the renderer via contextBridge (window.api). */
export interface Api {
  accounts: {
    list(): Promise<Account[]>
    get(id: string): Promise<Account | null>
    create(input: AccountInput): Promise<Account>
    update(id: string, input: Partial<AccountInput>): Promise<Account>
    remove(id: string): Promise<void>
    reveal(id: string): Promise<AccountSecrets>
    exportAll(): Promise<string>
    exportSelected(ids: string[]): Promise<string>
    exportEncrypted(password: string): Promise<string>
    importJson(json: string, password?: string): Promise<{ imported: number }>
    passwordHistory(accountId: string): Promise<PasswordHistoryEntry[]>
    revealPasswordHistory(historyId: number): Promise<string>
    restorePassword(accountId: string, historyId: number): Promise<void>
    /** Accounts in the recycle bin (soft-deleted). */
    listDeleted(): Promise<Account[]>
    restore(id: string): Promise<void>
    /** Permanently delete one soft-deleted account. */
    purge(id: string): Promise<void>
    /** Permanently delete everything in the recycle bin. */
    purgeDeleted(): Promise<{ purged: number }>
  }
  security: {
    audit(): Promise<SecurityReport>
    checkBreaches(): Promise<BreachResult[]>
  }
  providers: {
    list(type: ProviderType): Promise<ProviderSetting[]>
    save(input: ProviderSettingInput & { id?: string }): Promise<ProviderSetting>
    remove(id: string): Promise<void>
    setDefault(id: string): Promise<void>
    test(id: string): Promise<ProviderTestResult>
    peekMails(providerId?: string): Promise<MailPreview[]>
    peekAccountInbox(accountId: string): Promise<MailPreview[]>
    useAccountAsMailbox(accountId: string): Promise<ProviderSetting>
    listInboxes(): Promise<GeneratedInbox[]>
    peekGeneratedInbox(id: string): Promise<MailPreview[]>
    removeInbox(id: string): Promise<void>
    removeInboxes(ids: string[]): Promise<void>
    generateInboxes(count: number): Promise<GeneratedInbox[]>
    updateInboxes(ids: string[], patch: { notes?: string; tags?: string[] }): Promise<void>
  }
  totp: {
    get(id: string): Promise<TotpResult | null>
    preview(secret: string): Promise<TotpResult | null>
    parseUri(uri: string): Promise<TotpParseResult | null>
  }
  automation: {
    actions(platform: Platform): Promise<AutomationActionDescriptor[]>
    enqueue(req: EnqueueRequest): Promise<AutomationTask[]>
    cancel(taskId: string): Promise<void>
    tasks(): Promise<AutomationTask[]>
    delete(taskId: string): Promise<void>
    clear(): Promise<{ cleared: number }>
    retry(taskId: string): Promise<AutomationTask | null>
    registerPlatforms(): Promise<Platform[]>
    registerBatch(platform: Platform, count: number): Promise<{ created: AutomationTask[]; errors: string[] }>
    prepareRegister(input: RegisterPrepareInput): Promise<RegisterDraft[]>
    confirmRegister(
      platform: Platform,
      drafts: RegisterDraft[]
    ): Promise<{ created: AutomationTask[]; errors: string[] }>
    oauthPlatforms(): Promise<Platform[]>
    registerOauth(
      platform: Platform,
      sourceAccountIds: string[],
      oauthProvider: 'google' | 'github'
    ): Promise<{ created: AutomationTask[]; errors: string[] }>
    /** Open the account's isolated Chrome profile (headed, with its proxy) for manual use. */
    launchProfile(accountId: string, url?: string): Promise<{ ok: boolean; message: string }>
    /** Probe the account's effective proxy and return the exit IP. */
    checkProxy(accountId: string): Promise<{ ok: boolean; ip?: string; message: string }>
    /** Export the account profile's cookies as a JSON string. */
    exportCookies(accountId: string): Promise<string>
    /** Import cookies (Playwright JSON) into the account profile. */
    importCookies(accountId: string, json: string): Promise<{ imported: number }>
    refreshQuota(accountId: string): Promise<Account>
    refreshQuotas(accountIds: string[]): Promise<Account[]>
    captureSession(accountId: string): Promise<Account>
    /** Write this account into the local IDE / CLI login (Cursor state.vscdb, Codex auth.json, …). */
    applyLocal(accountId: string): Promise<LocalApplyResult>
    syncLocal(): Promise<LocalLoginSnapshot>
    onTaskUpdated(cb: (task: AutomationTask) => void): () => void
    onQuotaUpdated(cb: (event: QuotaSyncEvent) => void): () => void
  }
  oauth: {
    start(platform: Platform): Promise<OfficialOAuthStart>
    snapshot(loginId: string): Promise<OfficialOAuthStart>
    /** Null when the user cancelled the dialog before authorizing. */
    wait(loginId: string): Promise<AccountInput | null>
    submitCallback(loginId: string, url: string): Promise<AccountInput>
    cancel(loginId?: string): Promise<void>
    openUrl(url: string): Promise<void>
  }
  logs: {
    query(filter?: LogFilter): Promise<LogEntry[]>
    clear(): Promise<void>
    onNew(cb: (entry: LogEntry) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  lock: {
    status(): Promise<{ enabled: boolean; autoLockMinutes: number }>
    set(pin: string, autoLockMinutes: number): Promise<{ enabled: boolean; autoLockMinutes: number }>
    verify(pin: string): Promise<boolean>
    disable(pin: string): Promise<boolean>
    setAuto(minutes: number): Promise<{ enabled: boolean; autoLockMinutes: number }>
    lockNow(): Promise<void>
  }
  system: {
    detectChrome(): Promise<ChromeInfo>
    openPath(p: string): Promise<void>
    revealProfile(accountId: string): Promise<void>
    openDataDir(): Promise<void>
    openLogDir(): Promise<void>
    /** Prompt a native "save as" dialog and write `content`. Returns the path, or null if canceled. */
    saveFile(defaultName: string, content: string): Promise<string | null>
    cryptoAvailable(): Promise<boolean>
  }
  updater: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<void>
    install(): Promise<void>
    onChanged(cb: (status: UpdateStatus) => void): () => void
  }
  sms: {
    rent(opts: { service: string; country?: string; accountId?: string }): Promise<SmsRental>
    waitCode(rentalId: string, timeoutMs?: number): Promise<string>
    cancel(rentalId: string): Promise<void>
    list(): Promise<SmsRental[]>
    services(country?: string): Promise<SmsServiceOption[]>
  }
}

export interface GeneratedInbox {
  id: string
  providerId: string
  driver: string
  email: string
  source: 'test' | 'register'
  accountId: string
  createdAt: number
  hasToken: boolean
  notes: string
  tags: string[]
}

export type GoogleSignupMode = 'gmail' | 'existing'

export interface RegisterDraft {
  inboxId: string
  mailboxAccountId: string
  /** 收信 / 恢复邮箱，域名以生成结果为准。 */
  email: string
  /** 实际用来登录目标平台的邮箱。Google 自建 Gmail 时是 xxx@gmail.com。 */
  loginEmail: string
  driver: string
  password: string
  confirmPassword: string
  username: string
  label: string
  firstName: string
  lastName: string
  birthYear: string
  birthMonth: string
  birthDay: string
  gender: string
  country: string
  googleMode: GoogleSignupMode
}

export interface RegisterPrepareInput {
  platform: Platform
  count?: number
  inboxIds?: string[]
  mailboxAccountIds?: string[]
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'disabled'; message: string }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number; bytesPerSecond: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

export type SmsRentalStatus = 'pending' | 'code_received' | 'canceled' | 'expired' | 'finished'

export interface SmsRental {
  id: string
  remoteId: string
  phone: string
  localNumber: string
  countryCode: string
  driver: string
  service: string
  status: SmsRentalStatus
  code: string | null
  createdAt: number
  expiresAt: number | null
  cost?: number
  accountId?: string
  taskId?: string
}

export interface SmsServiceOption {
  code: string
  label: string
  available?: number
  price?: number
}
