import type { Account } from '@shared/types'
import { hasQuota } from '@shared/platformFlags'
import { getAccount, updateAccount } from '../db/repositories/accounts'
import { refreshAccountQuota } from './quota'
import { logger } from './logger'

export interface RevalidateProgress {
  account: Account
  done: number
  total: number
}

export interface RevalidateResult {
  checked: number
  alive: number
  dead: number
  skipped: number
}

/** A quota error that means the session is gone rather than a transient hiccup. */
function isAuthFailure(message: string): boolean {
  return /未登录|重新|失效|invalid.?grant|invalid.?token|unauthorized|forbidden|HTTP 40[13]|登录/i.test(message)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let running = false

/**
 * "401 掉线重登" for token-backed accounts. Re-fetching quota already re-mints
 * access tokens (Kiro / Antigravity / Cursor refresh tokens) and re-syncs the
 * session from the isolated Chrome profile on auth errors, so this drives that
 * and then flips the account between active/error based on the outcome —
 * without ever disturbing a manually-disabled account.
 */
export async function revalidateAccounts(
  ids: string[],
  opts?: { onProgress?: (p: RevalidateProgress) => void }
): Promise<RevalidateResult> {
  if (running) throw new Error('验活任务正在进行，请稍候')
  running = true
  const out: RevalidateResult = { checked: 0, alive: 0, dead: 0, skipped: 0 }
  try {
    const targets = [...new Set(ids)]
      .map((id) => getAccount(id))
      .filter((a): a is Account => !!a && hasQuota(a.platform))
    const total = targets.length
    let done = 0
    for (const acc of targets) {
      let refreshed: Account = acc
      try {
        refreshed = await refreshAccountQuota(acc.id, { sync: 'force' })
      } catch (e) {
        refreshed = getAccount(acc.id) || acc
        logger.warn('revalidate', `验活失败 ${acc.label}: ${(e as Error).message}`, { accountId: acc.id })
      }
      const err = refreshed.quota?.error || ''
      done += 1
      out.checked += 1
      if (acc.status === 'disabled') {
        out.skipped += 1
      } else if (err && isAuthFailure(err)) {
        out.dead += 1
        if (acc.status !== 'error') refreshed = updateAccount(acc.id, { status: 'error' })
      } else if (!err) {
        out.alive += 1
        if (acc.status === 'error') refreshed = updateAccount(acc.id, { status: 'active' })
      }
      opts?.onProgress?.({ account: refreshed, done, total })
      await sleep(160 + Math.random() * 240)
    }
    return out
  } finally {
    running = false
  }
}
