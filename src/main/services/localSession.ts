import { join } from 'node:path'
import type { Account, LocalLoginSnapshot, Platform } from '@shared/types'
import { looksLikeEmail, tokenFingerprint } from '@shared/identity'
import { normalizeCursorSession, parseTokenText } from '@shared/tokenImport'
import { createAccount, listAccounts, revealSecrets } from '../db/repositories/accounts'
import { identityFromJwt } from './identity'
import { home, readJsonFile, roaming } from './localApply'
import { logger } from './logger'

type Detected = {
  platform: Platform
  email: string
  token: string
  source: string
  running: boolean
}

function accountToken(acc: Account): string {
  const secrets = revealSecrets(acc.id)
  return (
    secrets.refreshToken ||
    acc.customFields.sessionToken ||
    acc.customFields.sessionKey ||
    acc.customFields.apiKey ||
    acc.customFields.accessToken ||
    ''
  )
}

function sameToken(a: string, b: string): boolean {
  if (!a || !b) return false
  const ca = normalizeCursorSession(a)
  const cb = normalizeCursorSession(b)
  if (ca && cb) return ca.jwt === cb.jwt
  return tokenFingerprint(a) === tokenFingerprint(b)
}

function matchAccount(row: Detected, accounts: Account[]): Account | undefined {
  const samePlat = accounts.filter((a) => a.platform === row.platform)
  return (
    samePlat.find((a) => sameToken(accountToken(a), row.token)) ||
    samePlat.find((a) => row.email && a.email.toLowerCase() === row.email.toLowerCase())
  )
}

function detectCursor(): Detected | null {
  const storage = readJsonFile(roaming('Cursor', 'User', 'globalStorage', 'storage.json')) || {}
  const cli = readJsonFile(join(home(), '.cursor', 'cli-config.json'))
  const auth = cli?.auth && typeof cli.auth === 'object' ? (cli.auth as Record<string, unknown>) : {}
  const token = String(
    storage['cursorAuth/accessToken'] || storage['cursorAuth/refreshToken'] || auth.accessToken || ''
  )
  const email = String(storage['cursorAuth/cachedEmail'] || auth.email || '')
  if (!token) return null
  return {
    platform: 'cursor',
    email: email || identityFromJwt(token).email,
    token,
    source: storage['cursorAuth/accessToken'] ? 'ide' : 'cli',
    running: false
  }
}

function detectKiro(): Detected | null {
  const file = readJsonFile(join(home(), '.kiro', 'oauth_creds.json'))
  const token = String(file?.refreshToken || file?.accessToken || '')
  if (!token) return null
  return {
    platform: 'kiro',
    email: String(file?.email || ''),
    token,
    source: 'ide',
    running: false
  }
}

function detectCodex(): Detected | null {
  const file = readJsonFile(join(home(), '.codex', 'auth.json'))
  const tokens = file?.tokens && typeof file.tokens === 'object' ? (file.tokens as Record<string, unknown>) : {}
  const token = String(tokens.refresh_token || tokens.access_token || '')
  if (!token) return null
  return { platform: 'openai', email: identityFromJwt(token).email, token, source: 'cli', running: false }
}

function detectClaude(): Detected | null {
  const file = readJsonFile(join(home(), '.claude', '.credentials.json'))
  const oauth =
    file?.claudeAiOauth && typeof file.claudeAiOauth === 'object'
      ? (file.claudeAiOauth as Record<string, unknown>)
      : {}
  const token = String(file?.sessionKey || oauth.refreshToken || oauth.accessToken || '')
  if (!token) return null
  return { platform: 'anthropic', email: String(file?.email || ''), token, source: 'cli', running: false }
}

function detectGrok(): Detected | null {
  const file = readJsonFile(join(home(), '.grok', 'auth.json'))
  const token = String(file?.apiKey || file?.accessToken || '')
  if (!token) return null
  return { platform: 'grok', email: String(file?.email || ''), token, source: 'cli', running: false }
}

function detectAntigravity(): Detected | null {
  const file = readJsonFile(join(home(), '.antigravity', 'oauth_creds.json'))
  const token = String(file?.refresh_token || file?.access_token || '')
  if (!token) return null
  return { platform: 'antigravity', email: String(file?.email || ''), token, source: 'ide', running: false }
}

function detectAll(): Detected[] {
  return [detectCursor(), detectKiro(), detectCodex(), detectClaude(), detectGrok(), detectAntigravity()].filter(
    (r): r is Detected => !!r
  )
}

export function syncLocalLogins(): LocalLoginSnapshot {
  const accounts = listAccounts()
  const detected = detectAll()
  const current: Partial<Record<Platform, string>> = {}
  const running: Partial<Record<Platform, boolean>> = {}
  const unmatched: LocalLoginSnapshot['unmatched'] = []
  const imported: Account[] = []

  for (const row of detected) {
    running[row.platform] = row.running
    const hit = matchAccount(row, [...imported, ...accounts])
    if (hit) {
      current[row.platform] = hit.id
      continue
    }
    if (!row.token) {
      unmatched.push({ platform: row.platform, email: row.email, source: row.source })
      continue
    }
    try {
      const parsed = parseTokenText(row.token, row.platform)
      if (!parsed) {
        unmatched.push({ platform: row.platform, email: row.email, source: row.source })
        continue
      }
      if (row.email && looksLikeEmail(row.email)) {
        parsed.email = row.email
        parsed.label = row.email
        parsed.username = row.email.split('@')[0]
      }
      if (!parsed.email) {
        unmatched.push({ platform: row.platform, email: row.email, source: row.source })
        continue
      }
      parsed.notes = parsed.notes || `从本机 ${row.source} 自动导入`
      parsed.tags = [...new Set([...(parsed.tags || []), 'local-import'])]
      const acc = createAccount(parsed)
      imported.push(acc)
      current[row.platform] = acc.id
      logger.info('automation', `本机登录自动入库: ${acc.platform} ${acc.email || acc.label}`)
    } catch (e) {
      logger.warn('automation', `本机登录导入失败: ${(e as Error).message}`)
      unmatched.push({ platform: row.platform, email: row.email, source: row.source })
    }
  }

  return { current, running, imported, unmatched }
}
