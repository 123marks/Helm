import { getDb } from '../index'
import type { Account, QuotaHistoryPoint, QuotaHistorySeries } from '@shared/types'
import { accountUsage } from '@shared/quotaSummary'

/** Two fetches inside this window collapse into one snapshot. */
const DEDUPE_MS = 5 * 60_000
const RETENTION_MS = 120 * 86_400_000

/** Append a point for an account whose quota was just fetched successfully. */
export function recordQuotaSnapshot(account: Account): void {
  const q = account.quota
  if (!q || q.error) return
  const usage = accountUsage(account)
  if (usage.percent == null && q.used == null) return

  const db = getDb()
  const last = db
    .prepare('SELECT ts FROM quota_snapshots WHERE account_id = ? ORDER BY ts DESC LIMIT 1')
    .get(account.id) as { ts: number } | undefined
  const now = q.fetchedAt || Date.now()
  if (last && now - last.ts < DEDUPE_MS) {
    db.prepare(
      `UPDATE quota_snapshots
       SET ts = ?, plan = ?, plan_kind = ?, percent = ?, used = ?, quota_limit = ?, unit = ?, meters_json = ?
       WHERE account_id = ? AND ts = ?`
    ).run(
      now,
      q.plan,
      q.planKind ?? '',
      usage.percent,
      q.used,
      q.limit,
      q.unit,
      q.meters ? JSON.stringify(q.meters) : null,
      account.id,
      last.ts
    )
    return
  }
  db.prepare(
    `INSERT INTO quota_snapshots
       (account_id, platform, ts, plan, plan_kind, percent, used, quota_limit, unit, meters_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    account.id,
    account.platform,
    now,
    q.plan,
    q.planKind ?? '',
    usage.percent,
    q.used,
    q.limit,
    q.unit,
    q.meters ? JSON.stringify(q.meters) : null
  )
}

export function pruneQuotaSnapshots(): number {
  const cutoff = Date.now() - RETENTION_MS
  const before = countSnapshots()
  getDb().prepare('DELETE FROM quota_snapshots WHERE ts < ?').run(cutoff)
  return before - countSnapshots()
}

function countSnapshots(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM quota_snapshots').get() as { n: number }
  return row?.n ?? 0
}

function bucketMs(days: number): number {
  if (days <= 2) return 3600_000 // hourly
  if (days <= 14) return 6 * 3600_000 // 4 points per day
  return 86_400_000 // daily
}

/**
 * Average usage per bucket, overall and per platform, so the cockpit can draw a
 * trend without pulling every raw row into the renderer.
 */
export function quotaHistory(days: number): QuotaHistorySeries {
  const span = Math.max(1, Math.min(120, Math.floor(days)))
  const step = bucketMs(span)
  const since = Date.now() - span * 86_400_000
  const rows = getDb()
    .prepare(
      `SELECT platform, ts, percent FROM quota_snapshots
       WHERE ts >= ? AND percent IS NOT NULL ORDER BY ts ASC`
    )
    .all(since) as { platform: string; ts: number; percent: number }[]

  const buckets = new Map<number, { sum: number; n: number; byPlatform: Map<string, { sum: number; n: number }> }>()
  for (const r of rows) {
    const key = Math.floor(r.ts / step) * step
    let b = buckets.get(key)
    if (!b) {
      b = { sum: 0, n: 0, byPlatform: new Map() }
      buckets.set(key, b)
    }
    b.sum += r.percent
    b.n += 1
    const p = b.byPlatform.get(r.platform) ?? { sum: 0, n: 0 }
    p.sum += r.percent
    p.n += 1
    b.byPlatform.set(r.platform, p)
  }

  const platforms = [...new Set(rows.map((r) => r.platform))]
  const points: QuotaHistoryPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, b]) => ({
      ts,
      average: b.n ? b.sum / b.n : null,
      samples: b.n,
      byPlatform: Object.fromEntries(
        [...b.byPlatform.entries()].map(([k, v]) => [k, v.n ? v.sum / v.n : null])
      )
    }))

  return { days: span, stepMs: step, platforms, points }
}
