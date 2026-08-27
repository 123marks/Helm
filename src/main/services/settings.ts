import { getDb } from '../db'
import type { AppSettings } from '@shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  maxConcurrency: 2,
  headless: false,
  chromePathOverride: null,
  connectMode: 'launch',
  cdpEndpoint: 'http://127.0.0.1:9222',
  language: 'zh',
  theme: 'dark',
  showQuotaHints: true,
  quotaAutoRefreshMinutes: 30,
  outlookKeepaliveHours: 0,
  slowMo: 50,
  skipUpdateVersion: ''
}

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored: Record<string, unknown> = {}
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value)
    } catch {
      stored[r.key] = r.value
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  // Coerce numeric fields so a bad value (e.g. NaN) can never wedge the
  // automation pump (`running < NaN` is always false → nothing schedules).
  const clean: Partial<AppSettings> = { ...patch }
  if (clean.maxConcurrency !== undefined)
    clean.maxConcurrency = clampInt(clean.maxConcurrency, 1, 10, DEFAULT_SETTINGS.maxConcurrency)
  if (clean.slowMo !== undefined) clean.slowMo = clampInt(clean.slowMo, 0, 5000, DEFAULT_SETTINGS.slowMo)
  if (clean.quotaAutoRefreshMinutes !== undefined) {
    clean.quotaAutoRefreshMinutes = clampInt(
      clean.quotaAutoRefreshMinutes,
      0,
      1440,
      DEFAULT_SETTINGS.quotaAutoRefreshMinutes
    )
  }
  if (clean.outlookKeepaliveHours !== undefined) {
    clean.outlookKeepaliveHours = clampInt(clean.outlookKeepaliveHours, 0, 720, DEFAULT_SETTINGS.outlookKeepaliveHours)
  }

  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const tx = getDb().transaction(() => {
    for (const [k, v] of Object.entries(clean)) {
      stmt.run(k, JSON.stringify(v))
    }
  })
  tx()
  return getSettings()
}
