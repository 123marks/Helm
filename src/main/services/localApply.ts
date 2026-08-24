import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import type { Account, LocalApplyResult, Platform } from '@shared/types'
import { hasLocalApply, localApplyLabel } from '@shared/platformFlags'
import { jwtPayload, normalizeCursorSession } from '@shared/tokenImport'
import { getAccount, revealSecrets, touchLastUsed } from '../db/repositories/accounts'
import { requireUnlocked } from './lock'
import { logger } from './logger'

type SecretPack = {
  acc: Account
  token: string
  custom: Record<string, string>
}

let sqlMod: SqlJsStatic | null = null

async function loadSql(): Promise<SqlJsStatic> {
  if (sqlMod) return sqlMod
  const req = createRequire(__filename)
  const wasmPath = req.resolve('sql.js/dist/sql-wasm.wasm')
  sqlMod = await initSqlJs({ locateFile: () => wasmPath })
  return sqlMod
}

export function home(): string {
  return process.env.USERPROFILE || process.env.HOME || homedir()
}

export function roaming(...parts: string[]): string {
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || join(home(), 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? join(home(), 'Library', 'Application Support')
        : join(home(), '.config')
  return join(base, ...parts)
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
}

function mergeJson(file: string, patch: Record<string, unknown>): void {
  let cur: Record<string, unknown> = {}
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        cur = parsed as Record<string, unknown>
      }
    } catch {
      cur = {}
    }
  }
  writeJson(file, { ...cur, ...patch })
}

export function processRunning(names: string[]): string[] {
  const hit: string[] = []
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true
      }).toLowerCase()
      for (const n of names) {
        if (out.includes(n.toLowerCase())) hit.push(n)
      }
      return hit
    }
    const out = execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8', timeout: 8000 })
    const low = out.toLowerCase()
    for (const n of names) {
      if (low.includes(n.toLowerCase().replace(/\.exe$/i, ''))) hit.push(n)
    }
  } catch {
    /* ignore */
  }
  return hit
}

const VSCDB_JS_MAX = 8 * 1024 * 1024
let sqlite3Bin: string | null | undefined

function fileSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

function findSqlite3(): string | null {
  if (sqlite3Bin !== undefined) return sqlite3Bin
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['sqlite3'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 3000
    })
    sqlite3Bin = 'sqlite3'
  } catch {
    sqlite3Bin = null
  }
  return sqlite3Bin
}

function sqlQuote(v: string): string {
  return v.replace(/'/g, "''")
}

function readViaSqlite3(file: string, keys: string[]): Record<string, string> {
  const bin = findSqlite3()
  const out: Record<string, string> = {}
  if (!bin || !keys.length) return out
  const list = keys.map((k) => `'${sqlQuote(k)}'`).join(',')
  try {
    const raw = execFileSync(bin, [file, '-json', `SELECT key, value FROM ItemTable WHERE key IN (${list});`], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    })
    const rows = JSON.parse(raw) as { key?: string; value?: unknown }[]
    for (const row of rows || []) {
      if (row.key) out[row.key] = row.value == null ? '' : String(row.value)
    }
  } catch {
    /* no sqlite3 or locked */
  }
  return out
}

function writeViaSqlite3(file: string, pairs: Record<string, string>): boolean {
  const bin = findSqlite3()
  if (!bin) return false
  const sql = Object.entries(pairs)
    .map(([k, v]) => `INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('${sqlQuote(k)}', '${sqlQuote(v)}');`)
    .join('')
  try {
    execFileSync(bin, [file, sql], { timeout: 15000, windowsHide: true, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function readJsonFile(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null
  if (fileSize(file) > VSCDB_JS_MAX) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export async function readVscdbValues(file: string, keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!existsSync(file) || !keys.length) return out
  const size = fileSize(file)
  // 本机 Cursor 状态库可能到数 GB。任何整文件/CLI 打开都会卡住主进程。
  if (size <= 0 || size > VSCDB_JS_MAX) return out
  const SQL = await loadSql()
  const db = new SQL.Database(readFileSync(file))
  try {
    for (const key of keys) {
      const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
      stmt.bind([key])
      if (stmt.step()) {
        const row = stmt.getAsObject() as { value?: unknown }
        const v = row.value
        out[key] = typeof v === 'string' ? v : v != null ? String(v) : ''
      }
      stmt.free()
    }
  } catch {
    /* schema mismatch */
  } finally {
    db.close()
  }
  return out
}

async function upsertVscdb(file: string, pairs: Record<string, string>): Promise<boolean> {
  if (!existsSync(file)) return false
  const size = fileSize(file)
  if (size <= 0 || size > VSCDB_JS_MAX) return false
  const bak = `${file}.aam-bak`
  if (!existsSync(bak) && size > 0 && size <= VSCDB_JS_MAX) {
    try {
      copyFileSync(file, bak)
    } catch {
      /* still try the write */
    }
  }
  if (writeViaSqlite3(file, pairs)) return true
  const SQL = await loadSql()
  const db = new SQL.Database(readFileSync(file))
  try {
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'")
    if (!tables.length) throw new Error('不是 VS Code 状态库（缺少 ItemTable）')
    for (const [key, value] of Object.entries(pairs)) {
      const stmt = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)')
      stmt.bind([key, value])
      stmt.step()
      stmt.free()
    }
    writeFileSync(file, Buffer.from(db.export()))
    return true
  } finally {
    db.close()
  }
}

function cursorJwt(pack: SecretPack): string {
  const raw = pack.custom.accessToken || pack.custom.sessionToken || pack.token
  const cur = normalizeCursorSession(raw)
  if (cur) return cur.jwt
  return raw.startsWith('eyJ') ? raw : ''
}

async function applyCursor(pack: SecretPack, written: string[]): Promise<void> {
  const jwt = cursorJwt(pack)
  if (!jwt) throw new Error('没有可用的 Cursor Token。请先官方授权或粘贴 WorkosCursorSessionToken')
  const email = pack.acc.email || String(jwtPayload(jwt)?.email || '')
  const signUp =
    pack.acc.oauthProvider === 'google'
      ? 'Google'
      : pack.acc.oauthProvider === 'github'
        ? 'GitHub'
        : 'Auth_0'
  const pairs = {
    'cursorAuth/accessToken': jwt,
    'cursorAuth/refreshToken': pack.custom.sessionToken || pack.token || jwt,
    'cursorAuth/cachedEmail': email,
    'cursorAuth/cachedSignUpType': signUp
  }
  const dbs = [
    roaming('Cursor', 'User', 'globalStorage', 'state.vscdb'),
    roaming('Cursor - Insiders', 'User', 'globalStorage', 'state.vscdb')
  ]
  for (const db of dbs) {
    try {
      if (await upsertVscdb(db, pairs)) written.push(db)
    } catch (e) {
      logger.warn('automation', `跳过 Cursor 状态库（文件过大或被占用）：${(e as Error).message}`)
    }
  }
  const storageJson = roaming('Cursor', 'User', 'globalStorage', 'storage.json')
  mergeJson(storageJson, pairs)
  written.push(storageJson)
  const cli = join(home(), '.cursor', 'cli-config.json')
  mergeJson(cli, {
    auth: {
      accessToken: jwt,
      refreshToken: pack.custom.sessionToken || pack.token || jwt,
      email
    }
  })
  written.push(cli)
}

async function applyKiro(pack: SecretPack, written: string[]): Promise<void> {
  const refresh = pack.token || pack.custom.refreshToken
  if (!refresh) throw new Error('没有 Kiro refreshToken。请先官方授权或导入 JSON')
  const cred = {
    refreshToken: refresh,
    accessToken: pack.custom.accessToken || '',
    clientId: pack.custom.clientId || pack.acc.mailboxClientId || '',
    clientSecret: pack.custom.clientSecret || '',
    email: pack.acc.email,
    provider: pack.custom.provider || pack.acc.oauthProvider || ''
  }
  const files = [
    join(home(), '.kiro', 'oauth_creds.json'),
    join(home(), '.kiro', 'settings', 'auth.json')
  ]
  for (const f of files) {
    writeJson(f, cred)
    written.push(f)
  }
  const db = roaming('Kiro', 'User', 'globalStorage', 'state.vscdb')
  try {
    if (
      await upsertVscdb(db, {
        'kiro.auth/refreshToken': cred.refreshToken,
        'kiro.auth/accessToken': cred.accessToken,
        'kiro.auth/clientId': cred.clientId,
        'kiro.auth/clientSecret': cred.clientSecret,
        'kiro.auth/email': cred.email
      })
    ) {
      written.push(db)
    }
  } catch {
    /* IDE 未装或被占用时，文件凭据仍可用 */
  }
}

async function applyWindsurf(pack: SecretPack, written: string[]): Promise<void> {
  const key = pack.custom.apiKey || pack.token
  if (!key) throw new Error('没有 Windsurf API Key。请先官方授权或粘贴 sk-ws-01-…')
  const cfg = join(home(), '.codeium', 'windsurf', 'config.json')
  mergeJson(cfg, { apiKey: key, email: pack.acc.email })
  written.push(cfg)
  const db = roaming('Windsurf', 'User', 'globalStorage', 'state.vscdb')
  try {
    if (await upsertVscdb(db, { 'windsurf.auth/apiKey': key, 'codeium.apiKey': key })) {
      written.push(db)
    }
  } catch {
    /* IDE 未装或被占用时，config.json 仍可用 */
  }
}

function applyOpenAI(pack: SecretPack, written: string[]): void {
  const refresh = pack.token
  const access = pack.custom.accessToken || refresh
  if (!refresh && !access) throw new Error('没有 OpenAI / Codex Token。请先官方授权')
  const file = join(home(), '.codex', 'auth.json')
  writeJson(file, {
    tokens: {
      access_token: access,
      refresh_token: refresh,
      id_token: pack.custom.idToken || ''
    },
    last_refresh: new Date().toISOString()
  })
  written.push(file)
}

function applyAnthropic(pack: SecretPack, written: string[]): void {
  const sessionKey = pack.custom.sessionKey || (pack.token.startsWith('sk-ant-') ? pack.token : '')
  const refresh = sessionKey ? '' : pack.token
  if (!sessionKey && !refresh) throw new Error('没有 Claude sessionKey / Token。请先导入或登录')
  const file = join(home(), '.claude', '.credentials.json')
  if (sessionKey) {
    writeJson(file, { sessionKey, email: pack.acc.email })
  } else {
    writeJson(file, {
      claudeAiOauth: {
        accessToken: pack.custom.accessToken || refresh,
        refreshToken: refresh,
        expiresAt: Number(pack.custom.tokenExpires) || Date.now() + 3600_000
      }
    })
  }
  written.push(file)
}

function applyGrok(pack: SecretPack, written: string[]): void {
  const apiKey = pack.custom.apiKey || (pack.token.startsWith('xai-') ? pack.token : '')
  const access = apiKey ? '' : pack.token
  if (!apiKey && !access) throw new Error('没有 Grok API Key 或会话。请先官方登录或粘贴 xai- Key')
  const file = join(home(), '.grok', 'auth.json')
  writeJson(file, { apiKey, accessToken: access, email: pack.acc.email })
  written.push(file)
}

function applyAntigravity(pack: SecretPack, written: string[]): void {
  const refresh = pack.token
  const access = pack.custom.accessToken || ''
  if (!refresh && !access) throw new Error('没有 Antigravity 的 Google Token。请先官方授权')
  const cred = {
    access_token: access,
    refresh_token: refresh,
    token_type: 'Bearer',
    expiry_date: Number(pack.custom.tokenExpires) || Date.now() + 3600_000
  }
  const files = [
    join(home(), '.antigravity', 'oauth_creds.json'),
    join(home(), '.gemini', 'oauth_creds.json')
  ]
  for (const f of files) {
    writeJson(f, cred)
    written.push(f)
  }
}

export const IDE_PROCESS: Partial<Record<Platform, string[]>> = {
  cursor: ['Cursor.exe', 'Cursor'],
  kiro: ['Kiro.exe', 'Kiro'],
  windsurf: ['Windsurf.exe', 'Windsurf'],
  antigravity: ['Antigravity.exe', 'Antigravity']
}

export async function applyAccountLocal(accountId: string): Promise<LocalApplyResult> {
  requireUnlocked()
  const acc = getAccount(accountId)
  if (!acc) throw new Error('账号不存在')
  if (!hasLocalApply(acc.platform)) {
    throw new Error(`${acc.platform} 没有可替换的本地 IDE / CLI 登录`)
  }
  const secrets = revealSecrets(accountId)
  const token =
    secrets.refreshToken ||
    acc.customFields.sessionToken ||
    acc.customFields.sessionKey ||
    acc.customFields.apiKey ||
    acc.customFields.accessToken ||
    ''
  const pack: SecretPack = { acc, token, custom: acc.customFields }
  const written: string[] = []
  const running = processRunning(IDE_PROCESS[acc.platform] || [])

  if (acc.platform === 'cursor') await applyCursor(pack, written)
  else if (acc.platform === 'kiro') await applyKiro(pack, written)
  else if (acc.platform === 'windsurf') await applyWindsurf(pack, written)
  else if (acc.platform === 'openai') applyOpenAI(pack, written)
  else if (acc.platform === 'anthropic') applyAnthropic(pack, written)
  else if (acc.platform === 'grok') applyGrok(pack, written)
  else if (acc.platform === 'antigravity') applyAntigravity(pack, written)

  touchLastUsed(accountId)
  const label = localApplyLabel(acc.platform)
  const who = acc.email || acc.label
  const restart = running.length ? `。${label} 正在运行，请关掉再开一次才会生效` : `。请重启 ${label} 后使用`
  const message = `已切换为 ${who}（${label}）${restart}`
  logger.info('automation', `应用到本地: ${acc.label} → ${written.join(' | ')}`, { accountId })
  return { ok: true, targets: written, running, message }
}
