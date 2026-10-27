import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { MemoryDbLogger } from './types'

export let logger: MemoryDbLogger = {
  info: () => {},
  warn: (source, message) => console.warn(`[${source}] ${message}`),
  error: (source, message) => console.error(`[${source}] ${message}`),
}

export function setMemoryDbLogger(l: MemoryDbLogger): void {
  logger = l
}

export let db: DatabaseSync | null = null
export let dbFile = ''
export let backupRootDir = ''
export let readyPromise: Promise<void> | null = null

export function memoryDbReady(): Promise<void> {
  if (!readyPromise) throw new Error('memoryDb 未初始化')
  return readyPromise
}

// 仅供自检/进程退出前释放资源
export function closeMemoryDb(): void {
  try {
    checkpoint()
    db?.close()
  } catch {
    /* ignore */
  }
  db = null
}

export function checkpoint(): void {
  try {
    db?.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch (err) {
    logger.warn('memory', `checkpoint 失败: ${(err as Error).message}`)
  }
}

export function withTx<T>(fn: () => T): T {
  if (!db) throw new Error('memoryDb 未初始化')
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* rollback 失败时保留原异常 */
    }
    throw err
  }
}

export function rows(query: string, params: SQLInputValue[] = []): Record<string, unknown>[] {
  if (!db) throw new Error('memoryDb 未初始化')
  return db.prepare(query).all(...params) as Record<string, unknown>[]
}

export function run(query: string, params: SQLInputValue[] = []): void {
  if (!db) throw new Error('memoryDb 未初始化')
  db.prepare(query).run(...params)
}

export function getMeta(key: string): string | null {
  const found = rows('SELECT value FROM meta WHERE key = ?', [key])
  return found.length > 0 ? String(found[0].value) : null
}

export function setMeta(key: string, value: string): void {
  run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value])
}

export function prepareMemoryDb(dataRoot: string, backupRoot?: string): void {
  fs.mkdirSync(dataRoot, { recursive: true })
  backupRootDir = backupRoot && backupRoot.trim() ? backupRoot : path.join(dataRoot, 'backups')
  fs.mkdirSync(backupRootDir, { recursive: true })
  dbFile = path.join(dataRoot, 'memory.db')
}

export function openMemoryDb(): void {
  db = new DatabaseSync(dbFile)
  db.exec('PRAGMA journal_mode = WAL')
}

export function setReadyPromise(promise: Promise<void>): void {
  readyPromise = promise
}
