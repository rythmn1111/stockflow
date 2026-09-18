import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { migrations, LATEST_VERSION } from './schema'
import { log } from '../lib/log'

let db: DatabaseSync | null = null
let dbPath = ''

export type SqlValue = string | number | null | Uint8Array

/**
 * node:sqlite rejects booleans and `undefined` outright, which is easy to trip over
 * when a repository forwards an optional field straight through. Normalise here so
 * call sites can stay declarative.
 */
export function bind(values: unknown[]): SqlValue[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null
    if (typeof v === 'boolean') return v ? 1 : 0
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string') return v
    if (v instanceof Uint8Array) return v
    if (v instanceof Date) return v.getTime()
    return JSON.stringify(v)
  })
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not initialised — call openDatabase() first')
  return db
}

export function getDbPath(): string {
  return dbPath
}

export function openDatabase(userDataPath: string): DatabaseSync {
  if (db) return db

  dbPath = join(userDataPath, 'data', 'stockflow.db')
  mkdirSync(dirname(dbPath), { recursive: true })

  const fresh = !existsSync(dbPath)
  db = new DatabaseSync(dbPath)

  // WAL keeps the scheduler's writes from blocking UI reads.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')

  runMigrations(db)
  log.info('db', `${fresh ? 'created' : 'opened'} ${dbPath} (schema v${LATEST_VERSION})`)
  return db
}

function currentVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

function runMigrations(database: DatabaseSync): void {
  const from = currentVersion(database)
  if (from > LATEST_VERSION) {
    throw new Error(
      `Database schema v${from} is newer than this app supports (v${LATEST_VERSION}). ` +
        'Update LeadFlow instead of downgrading.'
    )
  }

  for (const migration of migrations) {
    if (migration.version <= from) continue
    log.info('db', `migrating to v${migration.version} (${migration.name})`)
    database.exec('BEGIN')
    try {
      migration.up(database)
      // PRAGMA does not accept bound parameters.
      database.exec(`PRAGMA user_version = ${migration.version}`)
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      throw new Error(`Migration v${migration.version} (${migration.name}) failed: ${String(err)}`)
    }
  }
}

/** Wraps `fn` in a transaction; nested calls reuse the outer transaction. */
let txDepth = 0
export function transaction<T>(fn: () => T): T {
  const database = getDb()
  if (txDepth > 0) return fn()
  txDepth++
  database.exec('BEGIN')
  try {
    const result = fn()
    database.exec('COMMIT')
    return result
  } catch (err) {
    database.exec('ROLLBACK')
    throw err
  } finally {
    txDepth--
  }
}

export function closeDatabase(): void {
  if (!db) return
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    // Checkpointing is best-effort on shutdown.
  }
  db.close()
  db = null
}

export function query<T>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...bind(params)) as T[]
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...bind(params)) as T | undefined
}

export function run(sql: string, params: unknown[] = []): { changes: number } {
  const result = getDb()
    .prepare(sql)
    .run(...bind(params))
  return { changes: Number(result.changes) }
}
