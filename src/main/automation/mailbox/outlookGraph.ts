import { randomBytes } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { consumeStock, parseOutlookLine, splitStockLines, type OutlookItem } from './stock'
import type { Inbox, MailboxDriver, MailboxDriverContext, MailMessage } from './types'

const tokenCache = new Map<string, { access: string; exp: number }>()

function plusAddress(base: string, tag: string): string {
  const [local, domain] = base.split('@')
  if (!local || !domain) return base
  return `${local}+${tag}@${domain}`
}

function itemFromConfig(ctx: MailboxDriverContext): OutlookItem | null {
  const email = String(ctx.config.email || ctx.config.user || '').trim()
  const refreshToken = String(ctx.config.refreshToken || '').trim()
  if (!email || !refreshToken) return null
  return {
    email,
    password: String(ctx.config.password || ctx.config.pass || ''),
    clientId: String(ctx.config.clientId || ''),
    refreshToken,
    raw: ''
  }
}

function decodeToken(token: string): OutlookItem | null {
  try {
    const v = JSON.parse(token) as OutlookItem
    if (v?.email && v?.refreshToken) return v
  } catch {
    /* ignore */
  }
  return parseOutlookLine(token)
}

async function refreshAccess(item: OutlookItem, extraScope = ''): Promise<string> {
  const clientId = item.clientId.trim()
  if (!clientId) throw new Error('缺少 Azure 应用 client_id（库存行第 3 段或配置项）')
  const cacheKey = `${clientId}|${item.refreshToken.slice(0, 24)}|${extraScope}`
  const hit = tokenCache.get(cacheKey)
  if (hit && hit.exp - 60_000 > Date.now()) return hit.access

  const scope =
    extraScope ||
    'offline_access openid profile https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read'
  const endpoints = [
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    'https://login.microsoftonline.com/common/oauth2/v2.0/token'
  ]
  let last = 'refresh 失败'
  for (const url of endpoints) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: item.refreshToken,
        scope
      })
    })
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string
      expires_in?: number
      error?: string
      error_description?: string
    }
    if (json.access_token) {
      tokenCache.set(cacheKey, {
        access: json.access_token,
        exp: Date.now() + (Number(json.expires_in) || 3600) * 1000
      })
      return json.access_token
    }
    last = json.error_description || json.error || `HTTP ${res.status}`
  }
  throw new Error(`Outlook 令牌刷新失败：${last}`)
}

function graphToMail(email: string, item: Record<string, unknown>): MailMessage {
  const from = item.from as { emailAddress?: { address?: string } } | undefined
  const body = item.body as { content?: string; contentType?: string } | undefined
  const toList = item.toRecipients as Array<{ emailAddress?: { address?: string } }> | undefined
  const html = body?.contentType === 'html' ? String(body.content || '') : ''
  const text = body?.contentType === 'text' ? String(body.content || '') : html
  return {
    id: String(item.id || ''),
    subject: String(item.subject || ''),
    from: from?.emailAddress?.address || '',
    to: (toList || []).map((t) => t.emailAddress?.address || '').filter(Boolean).join(',') || email,
    text,
    html,
    receivedAt: Date.parse(String(item.receivedDateTime || '')) || Date.now()
  }
}

async function fetchGraph(item: OutlookItem, inboxEmail: string): Promise<MailMessage[]> {
  const access = await refreshAccess(item)
  const res = await fetch(
    'https://graph.microsoft.com/v1.0/me/messages?$top=20&$select=id,subject,from,body,receivedDateTime,toRecipients&$orderby=receivedDateTime desc',
    { headers: { authorization: `Bearer ${access}` } }
  )
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(err.error?.message || `Graph 读信失败（HTTP ${res.status}）`)
  }
  const json = (await res.json()) as { value?: Array<Record<string, unknown>> }
  const list = (json.value || []).map((m) => graphToMail(item.email, m))
  const needle = inboxEmail.toLowerCase()
  if (!needle || needle === item.email.toLowerCase()) return list
  const tag = needle.includes('+') ? needle.slice(needle.indexOf('+') + 1, needle.indexOf('@')) : ''
  return list.filter((m) => {
    const hay = `${m.to} ${m.subject} ${m.text}`.toLowerCase()
    return hay.includes(needle) || (tag && hay.includes(tag))
  })
}

async function fetchImapFolder(client: ImapFlow, folder: string): Promise<MailMessage[]> {
  const exists = await client.getMailboxLock(folder).catch(() => null)
  if (!exists) return []
  try {
    const since = new Date(Date.now() - 20 * 60 * 1000)
    const uids = await client.search({ since }, { uid: true })
    const list = Array.isArray(uids) ? uids.slice(-20) : []
    if (list.length === 0) return []
    const out: MailMessage[] = []
    for await (const msg of client.fetch(list, { envelope: true, source: true }, { uid: true })) {
      const parsed = msg.source ? await simpleParser(msg.source) : null
      const to = (msg.envelope?.to ?? []).map((a) => a.address || '').filter(Boolean).join(',')
      out.push({
        id: `${folder}:${msg.uid}`,
        subject: parsed?.subject || msg.envelope?.subject || '',
        from: parsed?.from?.text || msg.envelope?.from?.[0]?.address || '',
        text: parsed?.text || '',
        html: typeof parsed?.html === 'string' ? parsed.html : '',
        receivedAt: (msg.envelope?.date ?? new Date()).getTime(),
        to
      })
    }
    return out
  } finally {
    exists.release()
  }
}

async function fetchImapOauth(item: OutlookItem, inboxEmail: string): Promise<MailMessage[]> {
  const access = await refreshAccess(
    item,
    'offline_access https://outlook.office.com/IMAP.AccessAsUser.All'
  )
  const client = new ImapFlow({
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    auth: { user: item.email, accessToken: access },
    logger: false
  })
  await client.connect()
  try {
    // Verification mail often lands in Junk on fresh Outlook accounts, so scan
    // both folders (Junk names differ by locale — try the common ones).
    const out: MailMessage[] = []
    for (const folder of ['INBOX', 'Junk Email', 'Junk']) {
      out.push(...(await fetchImapFolder(client, folder)))
    }
    out.sort((a, b) => b.receivedAt - a.receivedAt)
    const needle = inboxEmail.toLowerCase()
    if (!needle || needle === item.email.toLowerCase()) return out
    return out.filter((m) => `${m.to} ${m.subject}`.toLowerCase().includes(needle))
  } finally {
    await client.logout().catch(() => undefined)
  }
}

export const outlookGraphDriver: MailboxDriver = {
  driver: 'outlook_graph',
  async createInbox(ctx) {
    const stock = String(ctx.config.stock || '').trim()
    const item = stock
      ? consumeStock(ctx, parseOutlookLine, 'Outlook 库存为空。请粘贴 email----密码----clientId----refreshToken')
      : itemFromConfig(ctx)
    if (!item) throw new Error('请填写 Outlook 账号，或粘贴 gr/o2 双令牌库存行')
    if (stock || ctx.config.plusAddressing === false) {
      return {
        driver: 'outlook_graph',
        email: item.email,
        token: JSON.stringify({
          email: item.email,
          password: item.password,
          clientId: item.clientId,
          refreshToken: item.refreshToken
        })
      }
    }
    const tag = randomBytes(4).toString('hex')
    return {
      driver: 'outlook_graph',
      email: plusAddress(item.email, tag),
      token: JSON.stringify({
        email: item.email,
        password: item.password,
        clientId: item.clientId,
        refreshToken: item.refreshToken
      })
    }
  },
  async fetchMails(_ctx, inbox) {
    const item = decodeToken(inbox.token)
    if (!item) return []
    try {
      return await fetchGraph(item, inbox.email)
    } catch (graphErr) {
      try {
        return await fetchImapOauth(item, inbox.email)
      } catch {
        throw graphErr
      }
    }
  },
  async test(ctx) {
    const lines = splitStockLines(String(ctx.config.stock || ''))
    const item = lines[0] ? parseOutlookLine(lines[0]) : itemFromConfig(ctx)
    if (!item) return { ok: false, message: '请填写 refreshToken，或粘贴一行双令牌账号（测试不扣库存）' }
    try {
      const mails = await fetchGraph(item, item.email)
      return {
        ok: true,
        message: `Graph 可用，${item.email} 近 20 封里有 ${mails.length} 封${lines.length ? `，库存 ${lines.length}` : ''}`
      }
    } catch (e) {
      try {
        const mails = await fetchImapOauth(item, item.email)
        return { ok: true, message: `Graph 失败，OAuth2 IMAP 可用，读到 ${mails.length} 封` }
      } catch {
        return { ok: false, message: (e as Error).message }
      }
    }
  }
}
