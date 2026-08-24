import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Directory names this app used before it was renamed to Helm. */
const LEGACY_APP_DIRS = ['AI Account Manager', 'ai-account-manager']
/** Files that mean "this directory already holds a real profile". */
const DB_FILES = ['helm.sqlite', 'ai-account-manager.sqlite']
/**
 * Copied as-is; usually a few MB at most. `Local State` is essential: on
 * Windows it holds the DPAPI-wrapped OSCrypt key that `safeStorage` — and
 * therefore `master.key` — was encrypted with.
 */
const SMALL_ENTRIES = ['master.key', 'Local State', 'logs', 'screenshots']
const PROFILES = 'chrome-profiles'

function hasData(dir: string): boolean {
  return DB_FILES.some((f) => existsSync(join(dir, f)))
}

function findLegacyDir(userData: string): string | null {
  const parent = dirname(userData)
  const current = basename(userData)
  for (const name of LEGACY_APP_DIRS) {
    if (name === current) continue
    const candidate = join(parent, name)
    if (existsSync(candidate) && hasData(candidate)) return candidate
  }
  return null
}

/** Above this, copying Chrome profiles would stall startup, so we move them. */
const COPY_PROFILES_LIMIT = 2 * 1024 * 1024 * 1024

/** Total bytes under `dir`, giving up as soon as it exceeds `limit`. */
function sizeUpTo(dir: string, limit: number): number {
  let total = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop() as string
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(current, { withFileTypes: true }) as never
    } catch {
      continue
    }
    for (const entry of entries as unknown as { name: string; isDirectory(): boolean }[]) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(child)
        continue
      }
      try {
        total += statSync(child).size
      } catch {
        /* vanished mid-scan */
      }
      if (total > limit) return total
    }
  }
  return total
}

export interface MigrationResult {
  from: string
  movedProfiles: boolean
}

/**
 * Carry an install from the pre-Helm data directory into the current one.
 * Everything is copied so the old folder stays usable as a backup, except an
 * oversized Chrome profile tree, which is moved to keep startup responsive.
 */
export function migrateLegacyUserData(userData: string): MigrationResult | null {
  if (hasData(userData)) return null
  const legacy = findLegacyDir(userData)
  if (!legacy) return null
  // Chromium rewrites `Local State` as the browser process comes up, so this
  // has to happen before `app.whenReady()` or the OSCrypt key is already lost.
  if (existsSync(join(userData, 'Local State'))) return null

  mkdirSync(userData, { recursive: true })
  for (const file of DB_FILES) {
    const src = join(legacy, file)
    if (existsSync(src)) cpSync(src, join(userData, file))
  }
  for (const entry of SMALL_ENTRIES) {
    const src = join(legacy, entry)
    if (!existsSync(src)) continue
    cpSync(src, join(userData, entry), { recursive: true })
  }

  let movedProfiles = false
  const srcProfiles = join(legacy, PROFILES)
  const dstProfiles = join(userData, PROFILES)
  if (existsSync(srcProfiles) && !existsSync(dstProfiles)) {
    if (sizeUpTo(srcProfiles, COPY_PROFILES_LIMIT) <= COPY_PROFILES_LIMIT) {
      cpSync(srcProfiles, dstProfiles, { recursive: true })
    } else {
      try {
        renameSync(srcProfiles, dstProfiles)
        movedProfiles = true
      } catch {
        cpSync(srcProfiles, dstProfiles, { recursive: true })
      }
    }
  }
  return { from: legacy, movedProfiles }
}

/** `<userData>/ai-account-manager.sqlite` → `<userData>/helm.sqlite`. */
export function adoptLegacyDbFile(userData: string, dbFile: string): void {
  if (existsSync(dbFile)) return
  const legacy = join(userData, 'ai-account-manager.sqlite')
  if (!existsSync(legacy) || !statSync(legacy).isFile()) return
  try {
    renameSync(legacy, dbFile)
  } catch {
    cpSync(legacy, dbFile)
  }
}

/**
 * Chrome profile paths are stored absolute, so they break whenever the data
 * directory moves. Re-point any row whose folder name still matches its id.
 */
export function relocatedProfileDirs(
  profilesRoot: string,
  rows: { id: string; profileDir: string }[]
): { id: string; profileDir: string }[] {
  const known = existsSync(profilesRoot) ? new Set(readdirSync(profilesRoot)) : new Set<string>()
  const out: { id: string; profileDir: string }[] = []
  for (const row of rows) {
    const want = join(profilesRoot, row.id)
    if (row.profileDir === want) continue
    if (!known.has(row.id) && existsSync(row.profileDir)) continue
    out.push({ id: row.id, profileDir: want })
  }
  return out
}
