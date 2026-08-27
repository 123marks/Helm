import type { AutomationTask, Platform, RegisterDraft, RegisterPrepareInput } from '@shared/types'
import {
  draftIssues,
  gmailLocal,
  githubUsername,
  isGoogleFamily,
  loginEmailOf,
  randomAdultBirth,
  randomPersonName,
  syncDraftIdentity
} from '@shared/registerProfile'
import { enqueue } from './engine'
import { createInbox } from './mailbox'
import { setTaskSecret } from './secrets'
import { createAccount, getAccount, getAccountForAutomation } from '../db/repositories/accounts'
import {
  getGeneratedInbox,
  linkInboxById,
  recordGeneratedInbox,
  revealInboxToken
} from '../db/repositories/inboxes'
import { allocateOutlookAccount } from '../services/outlookPool'
import { genPassword } from './flows/util'
import { logger } from '../services/logger'

export interface RegisterBatchResult {
  created: AutomationTask[]
  errors: string[]
}

function draftFromInbox(platform: Platform, inboxId: string, email: string, driver: string): RegisterDraft {
  const { firstName, lastName } = randomPersonName()
  const birth = randomAdultBirth()
  const googleMode = isGoogleFamily(platform) ? 'gmail' : 'existing'
  const username = platform === 'github' ? githubUsername() : googleMode === 'gmail' ? gmailLocal(firstName, lastName) : email.split('@')[0] || 'user'
  const password = genPassword(platform === 'github' ? 18 : 16)
  const loginEmail = loginEmailOf(platform, { email, username, googleMode })
  return {
    inboxId,
    mailboxAccountId: '',
    email,
    loginEmail,
    driver,
    password,
    confirmPassword: password,
    username,
    label: loginEmail,
    firstName,
    lastName,
    ...birth,
    gender: '3',
    country: 'United States of America',
    googleMode
  }
}

export async function prepareRegistrations(input: RegisterPrepareInput): Promise<RegisterDraft[]> {
  const platform = input.platform
  const drafts: RegisterDraft[] = []

  if (input.inboxIds?.length) {
    for (const id of input.inboxIds) {
      const row = getGeneratedInbox(id)
      if (!row) throw new Error(`邮箱记录不存在：${id.slice(0, 8)}`)
      drafts.push(draftFromInbox(platform, row.id, row.email, row.driver))
    }
    return drafts
  }

  if (input.outlookPoolCount && input.outlookPoolCount > 0) {
    const n = Math.max(1, Math.min(50, Math.floor(input.outlookPoolCount)))
    for (let i = 0; i < n; i++) {
      const item = allocateOutlookAccount()
      if (!item) {
        if (drafts.length === 0) throw new Error('Outlook 池里没有可用的有效号，请先导入或保活')
        break
      }
      // Record the allocated account as an outlook_graph inbox so the rest of
      // the pipeline (resolveMailbox → read code) works with no special-casing.
      const rec = recordGeneratedInbox({
        driver: 'outlook_graph',
        email: item.email,
        token: JSON.stringify({
          email: item.email,
          password: item.password,
          clientId: item.clientId,
          refreshToken: item.refreshToken
        }),
        source: 'register'
      })
      drafts.push(draftFromInbox(platform, rec.id, item.email, 'outlook_graph'))
    }
    return drafts
  }

  if (input.mailboxAccountIds?.length) {
    for (const accountId of input.mailboxAccountIds) {
      const packed = getAccountForAutomation(accountId)
      if (!packed) throw new Error('收信账号不存在')
      const { account, secrets } = packed
      if (!account.email.includes('@')) throw new Error(`${account.label || accountId} 没有邮箱`)
      const token = secrets.mailboxAppPassword || secrets.password || secrets.refreshToken || ''
      if (!token) throw new Error(`${account.email} 没有收信凭证`)
      const base = draftFromInbox(platform, '', account.email, account.mailboxKind || 'imap')
      drafts.push({ ...base, mailboxAccountId: account.id, label: account.email === base.loginEmail ? account.email : base.loginEmail })
    }
    return drafts
  }

  const n = Math.max(1, Math.min(50, Math.floor(input.count || 1)))
  for (let i = 0; i < n; i++) {
    const inbox = await createInbox()
    if (!inbox.recordId) throw new Error('生成邮箱后未能写入记录')
    drafts.push(draftFromInbox(platform, inbox.recordId, inbox.email, inbox.driver))
  }
  return drafts
}

function resolveMailbox(draft: RegisterDraft): { driver: string; token: string; email: string } {
  if (draft.inboxId) {
    const row = getGeneratedInbox(draft.inboxId)
    if (!row) throw new Error(`邮箱记录不存在：${draft.email}`)
    return { driver: row.driver, token: revealInboxToken(draft.inboxId), email: row.email }
  }
  if (draft.mailboxAccountId) {
    const packed = getAccountForAutomation(draft.mailboxAccountId)
    if (!packed) throw new Error('收信账号不存在')
    const token =
      packed.secrets.mailboxAppPassword || packed.secrets.password || packed.secrets.refreshToken || ''
    if (!token) throw new Error(`${packed.account.email} 没有收信凭证`)
    return {
      driver: packed.account.mailboxKind || 'imap',
      token,
      email: packed.account.email
    }
  }
  throw new Error('草稿缺少邮箱来源')
}

export async function confirmRegistrations(
  platform: Platform,
  drafts: RegisterDraft[]
): Promise<RegisterBatchResult> {
  const created: AutomationTask[] = []
  const errors: string[] = []
  for (const [i, raw] of drafts.entries()) {
    try {
      const draft = syncDraftIdentity(platform, raw)
      const issues = draftIssues(platform, draft)
      if (issues.length) throw new Error(issues.join('；'))
      const box = resolveMailbox(draft)
      const loginEmail = (draft.loginEmail || box.email).trim()
      const username = (draft.username || loginEmail.split('@')[0] || 'user').trim()
      const account = createAccount({
        platform,
        label: (draft.label || loginEmail).trim(),
        username,
        email: loginEmail,
        password: draft.password,
        recoveryEmail: box.email !== loginEmail ? box.email : '',
        status: 'active',
        tags: ['auto-register'],
        notes: `待注册 ${platform} · 登录 ${loginEmail} · 收信 ${box.email} · 驱动 ${box.driver}`,
        mailboxKind: box.driver,
        mailboxAppPassword: box.token,
        customFields: {
          firstName: draft.firstName,
          lastName: draft.lastName,
          birthYear: draft.birthYear,
          birthMonth: draft.birthMonth,
          birthDay: draft.birthDay,
          gender: draft.gender,
          country: draft.country,
          googleMode: draft.googleMode
        }
      })
      if (draft.inboxId) linkInboxById(draft.inboxId, account.id)
      const tasks = enqueue({
        accountIds: [account.id],
        type: 'register',
        params: {
          mailboxDriver: box.driver,
          mailboxEmail: box.email,
          loginEmail,
          username,
          firstName: draft.firstName,
          lastName: draft.lastName,
          birthYear: draft.birthYear,
          birthMonth: draft.birthMonth,
          birthDay: draft.birthDay,
          gender: draft.gender,
          country: draft.country,
          googleMode: draft.googleMode,
          confirmPassword: draft.password
        }
      })
      for (const t of tasks) setTaskSecret(t.id, 'mailboxToken', box.token)
      created.push(...tasks)
    } catch (e) {
      const msg = `#${i + 1} ${raw.loginEmail || raw.email}: ${(e as Error).message}`
      errors.push(msg)
      logger.warn('automation', `注册确认失败 ${msg}`)
    }
  }
  return { created, errors }
}

export async function enqueueRegistrations(
  platform: Platform,
  count: number,
  params: Record<string, unknown> = {}
): Promise<RegisterBatchResult> {
  const drafts = await prepareRegistrations({ platform, count })
  const confirmed = drafts.map((d) => ({ ...d, ...params }))
  return confirmRegistrations(platform, confirmed)
}

export async function enqueueOauthRegistrations(
  platform: Platform,
  sourceAccountIds: string[],
  oauthProvider: 'google' | 'github'
): Promise<RegisterBatchResult> {
  const created: AutomationTask[] = []
  const errors: string[] = []
  for (const sourceId of sourceAccountIds) {
    try {
      const source = getAccount(sourceId)
      if (!source) throw new Error('源账号不存在')
      const account = createAccount({
        platform,
        label: source.email || source.label || `${platform}-oauth`,
        username: source.username || source.email.split('@')[0] || '',
        email: source.email,
        status: 'active',
        tags: ['oauth-register'],
        notes: `OAuth 待完成 · 源 ${source.label || source.email}`,
        oauthProvider,
        oauthSourceAccountId: source.id
      })
      created.push(
        ...enqueue({
          accountIds: [account.id],
          type: 'register_oauth',
          params: { oauthProvider, sourceAccountId: source.id }
        })
      )
    } catch (e) {
      errors.push(`${sourceId}: ${(e as Error).message}`)
    }
  }
  return { created, errors }
}
