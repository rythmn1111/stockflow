import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getDb, getDbPath, settingsRepo } from '../db'
import { log, errText } from '../lib/log'

export interface BackupInfo {
  path: string
  createdAt: number
  sizeBytes: number
}

function backupDir(userDataPath: string): string {
  const dir = join(userDataPath, 'backups')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Uses SQLite's own VACUUM INTO so the snapshot is consistent even while the scheduler
 * is writing; a plain file copy of a WAL database can capture a torn state.
 */
export function createBackup(userDataPath: string, label = 'auto'): BackupInfo | null {
  try {
    const dir = backupDir(userDataPath)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(dir, `stockflow-${label}-${stamp}.db`)
    getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    const info = { path: target, createdAt: Date.now(), sizeBytes: statSync(target).size }
    log.info('backup', `wrote ${target} (${Math.round(info.sizeBytes / 1024)} KB)`)
    pruneBackups(userDataPath)
    return info
  } catch (err) {
    log.error('backup', 'backup failed', err)
    return null
  }
}

export function listBackups(userDataPath: string): BackupInfo[] {
  const dir = backupDir(userDataPath)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const full = join(dir, f)
      const stat = statSync(full)
      return { path: full, createdAt: stat.mtimeMs, sizeBytes: stat.size }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Snapshots kept regardless of age, so a long absence can never leave you with none. */
const ALWAYS_KEEP = 3

export function pruneBackups(userDataPath: string): number {
  const { backupRetentionDays } = settingsRepo.getAll()
  if (backupRetentionDays <= 0) return 0
  const cutoff = Date.now() - backupRetentionDays * 86_400_000
  // listBackups() is newest-first, so the floor is simply the first ALWAYS_KEEP entries.
  // Without it, opening the app after a gap longer than the retention window deletes
  // every snapshot the user had.
  const candidates = listBackups(userDataPath).slice(ALWAYS_KEEP)
  let removed = 0
  for (const backup of candidates) {
    if (backup.createdAt >= cutoff) continue
    try {
      rmSync(backup.path, { force: true })
      removed++
    } catch (err) {
      log.warn('backup', `could not prune ${backup.path}: ${errText(err)}`)
    }
  }
  return removed
}

/** Copies a chosen backup over the live database; the app must restart afterwards. */
export function stageRestore(backupPath: string): { ok: boolean; error?: string } {
  if (!existsSync(backupPath)) return { ok: false, error: 'That backup file no longer exists' }
  try {
    const live = getDbPath()
    copyFileSync(backupPath, `${live}.restore`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/** Applied at startup, before the database is opened. */
export function applyPendingRestore(dbPath: string): boolean {
  const staged = `${dbPath}.restore`
  if (!existsSync(staged)) return false
  try {
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${dbPath}${suffix}`
      if (existsSync(sidecar)) rmSync(sidecar, { force: true })
    }
    copyFileSync(staged, dbPath)
    rmSync(staged, { force: true })
    log.info('backup', 'restored database from staged backup')
    return true
  } catch (err) {
    log.error('backup', 'restore failed', err)
    return false
  }
}
