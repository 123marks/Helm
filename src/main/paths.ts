import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { adoptLegacyDbFile } from './services/dataMigration'

export interface AppPaths {
  userData: string
  profiles: string
  screenshots: string
  logs: string
  dbFile: string
  keyFile: string
}

let dirs: AppPaths | null = null

export function initPaths(userData: string): AppPaths {
  dirs = {
    userData,
    profiles: join(userData, 'chrome-profiles'),
    screenshots: join(userData, 'screenshots'),
    logs: join(userData, 'logs'),
    dbFile: join(userData, 'helm.sqlite'),
    keyFile: join(userData, 'master.key')
  }
  for (const d of [dirs.profiles, dirs.screenshots, dirs.logs]) {
    mkdirSync(d, { recursive: true })
  }
  adoptLegacyDbFile(userData, dirs.dbFile)
  return dirs
}

export function paths(): AppPaths {
  if (!dirs) throw new Error('paths() called before initPaths()')
  return dirs
}
