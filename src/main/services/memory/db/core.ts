import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { RoleDatabasePort, SqlParam, SqlRunResult } from '@core/memory/port'
import { ROLE_DB_SCHEMA, ROLE_DB_SCHEMA_VERSION, RoleDbVersionError } from '@core/memory/schema'
import { reconcileDuplicateRoleIds } from '../../role/store'
import type { MemoryDbLogger } from '../model/types'
import { getErrorMessage } from '@shared/app/errors'

const SILENT_LOGGER: MemoryDbLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

export let logger: MemoryDbLogger = SILENT_LOGGER

export function setMemoryDbLogger(next: MemoryDbLogger): void {
  logger = next
}

export let dataRootDir = ''
export let backupRootDir = ''
export let readyPromise: Promise<void> | null = null

export function setReadyPromise(promise: Promise<void> | null): void {
  readyPromise = promise
}

export async function memoryDbReady(): Promise<void> {
  if (readyPromise) await readyPromise
}

export class NodeSqlitePort implements RoleDatabasePort {
  readonly raw: DatabaseSync
  private txDepth = 0
  private closed = false

  constructor(filePath: string) {
    this.raw = new DatabaseSync(filePath)
    this.raw.exec('PRAGMA journal_mode = WAL')
    this.raw.exec('PRAGMA busy_timeout = 5000')
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  run(sql: string, params: readonly SqlParam[] = []): SqlRunResult {
    const info = this.raw.prepare(sql).run(...(params as SQLInputValue[]))
    return {
      changes: Number(info.changes),
      lastInsertRowid: Number(info.lastInsertRowid),
    }
  }

  query<T = Record<string, unknown>>(sql: string, params: readonly SqlParam[] = []): T[] {
    return this.raw.prepare(sql).all(...(params as SQLInputValue[])) as unknown as T[]
  }

  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn()
    this.txDepth++
    this.raw.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.raw.exec('COMMIT')
      return out
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK')
      } catch (rollbackErr) {
        logger.error('memory', `ROLLBACK 失败: ${getErrorMessage(rollbackErr)}`)
      }
      throw err
    } finally {
      this.txDepth--
    }
  }

  checkpoint(mode: 'PASSIVE' | 'TRUNCATE' = 'PASSIVE'): void {
    if (this.closed) return
    try {
      this.raw.exec(`PRAGMA wal_checkpoint(${mode})`)
    } catch (err) {
      logger.warn('memory', `checkpoint(${mode}) 失败: ${getErrorMessage(err)}`)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignore checkpoint error on close */
    }
    this.raw.close()
  }
}

export interface RoleDbHandle {
  roleId: string
  folderName: string
  roleDir: string
  dbFile: string
  port: NodeSqlitePort
}

const openHandles = new Map<string, RoleDbHandle>()

export function sanitizeRoleFolderName(raw: string): string {
  const cleaned = Array.from(raw.trim())
    .map((ch) => (ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.+$/g, '')
    .trim()
  return cleaned || 'default'
}

function ensureDataRoot(): string {
  if (dataRootDir) return dataRootDir
  const fallback = path.resolve(process.cwd(), 'data')
  prepareMemoryDb(fallback)
  return dataRootDir
}

function readCardIdInDir(dir: string): string | null {
  for (const fileName of ['opengal.json', 'role.json', 'character.json']) {
    const full = path.join(dir, fileName)
    if (!fs.existsSync(full)) continue
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf-8')) as { id?: unknown }
      if (typeof parsed.id === 'string' && parsed.id.trim()) return parsed.id.trim()
    } catch {
      continue
    }
  }
  return null
}

interface CachedRoleDirIndex {
  dataRoot: string
  rolesDirMtimeMs: number
  byId: Map<string, { roleDir: string; folderName: string }>
}

let roleDirCache: CachedRoleDirIndex | null = null

export function invalidateRoleDirCache(): void {
  roleDirCache = null
}

function buildRoleDirIndex(dataRoot: string): Map<string, { roleDir: string; folderName: string }> {
  const root = path.join(dataRoot, 'roles')
  const byId = new Map<string, { roleDir: string; folderName: string }>()
  if (!fs.existsSync(root)) return byId

  try {
    reconcileDuplicateRoleIds(dataRoot)
  } catch {
    /* 扫描期异常不阻断已有映射 */
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return byId
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidateDir = path.join(root, entry.name)
    const cardId = readCardIdInDir(candidateDir)
    if (cardId && !byId.has(cardId)) {
      byId.set(cardId, { roleDir: candidateDir, folderName: entry.name })
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidateDir = path.join(root, entry.name)
    if (!byId.has(entry.name)) {
      byId.set(entry.name, { roleDir: candidateDir, folderName: entry.name })
    }
  }
  return byId
}

export function resolveRoleDbDir(roleId: string): { roleDir: string; folderName: string } {
  const currentDataRoot = ensureDataRoot()
  const root = path.join(currentDataRoot, 'roles')
  if (fs.existsSync(root)) {
    let mtimeMs = 0
    try {
      mtimeMs = fs.statSync(root).mtimeMs
    } catch {
      mtimeMs = 0
    }
    if (
      !roleDirCache ||
      roleDirCache.dataRoot !== currentDataRoot ||
      roleDirCache.rolesDirMtimeMs !== mtimeMs
    ) {
      roleDirCache = {
        dataRoot: currentDataRoot,
        rolesDirMtimeMs: mtimeMs,
        byId: buildRoleDirIndex(currentDataRoot),
      }
    }
    const cached = roleDirCache.byId.get(roleId)
    if (cached && fs.existsSync(cached.roleDir)) {
      return cached
    }
    roleDirCache = {
      dataRoot: currentDataRoot,
      rolesDirMtimeMs: mtimeMs,
      byId: buildRoleDirIndex(currentDataRoot),
    }
    const refreshed = roleDirCache.byId.get(roleId)
    if (refreshed && fs.existsSync(refreshed.roleDir)) {
      return refreshed
    }
  }
  const folderName = sanitizeRoleFolderName(roleId)
  return { roleDir: path.join(root, folderName), folderName }
}

function backupBeforeSchemaUpgrade(port: NodeSqlitePort, folderName: string, fromVersion: number): void {
  if (!backupRootDir) return
  try {
    const day = new Date().toISOString().slice(0, 10)
    const dir = path.join(backupRootDir, 'roles', sanitizeRoleFolderName(folderName))
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `memory-pre-v${fromVersion}-${day}.db`)
    if (fs.existsSync(file)) return
    port.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    logger.info('memory', `升级前已备份角色库 (${folderName}): ${file}`)
  } catch (err) {
    logger.warn('memory', `升级前备份失败 (${folderName}): ${getErrorMessage(err)}`)
  }
}

function migrateMessagesV2(port: NodeSqlitePort): void {
  const cols = new Set(
    port.query<{ name: string }>('PRAGMA table_info(messages)').map((col) => col.name),
  )
  if (cols.size === 0) return
  port.transaction(() => {
    if (!cols.has('client_id')) port.exec('ALTER TABLE messages ADD COLUMN client_id TEXT')
    if (!cols.has('translation')) port.exec('ALTER TABLE messages ADD COLUMN translation TEXT')
    if (!cols.has('translation_lang')) port.exec('ALTER TABLE messages ADD COLUMN translation_lang TEXT')
    port.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id) WHERE client_id IS NOT NULL',
    )
  })
}

function verifyAndMigrateHandle(port: NodeSqlitePort, folderName: string): void {
  const check = port.query<{ quick_check?: string }>('PRAGMA quick_check')[0]
  if (check?.quick_check !== 'ok') {
    throw new Error(`角色记忆库完整性检查失败: ${JSON.stringify(check)}`)
  }

  const hasMeta =
    port.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").length > 0
  let existingVersion = 0
  if (hasMeta) {
    const verRow = port.query<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")[0]
    if (verRow?.value !== undefined) {
      const dbVer = Number(verRow.value)
      if (Number.isFinite(dbVer)) {
        existingVersion = dbVer
        if (dbVer > ROLE_DB_SCHEMA_VERSION) {
          throw new RoleDbVersionError(dbVer, ROLE_DB_SCHEMA_VERSION)
        }
      }
    }
  }

  if (existingVersion > 0 && existingVersion < ROLE_DB_SCHEMA_VERSION) {
    backupBeforeSchemaUpgrade(port, folderName, existingVersion)
    migrateMessagesV2(port)
  }

  port.exec(ROLE_DB_SCHEMA)
  migrateMessagesV2(port)

  const indexed = new Set(port.query<{ rowid: number }>('SELECT rowid FROM messages_fts').map((r) => Number(r.rowid)))
  const pending = port
    .query<{ id: number; content: string }>('SELECT id, content FROM messages WHERE archived < 2')
    .filter((r) => !indexed.has(Number(r.id)))
  if (pending.length > 0) {
    port.transaction(() => {
      for (const row of pending) {
        port.run('INSERT INTO messages_fts(rowid, message_id, tokens) VALUES(?, ?, ?)', [
          row.id,
          row.id,
          row.content,
        ])
      }
    })
  }

  port.transaction(() => {
    port.run('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)', [
      'schema_version',
      String(ROLE_DB_SCHEMA_VERSION),
    ])
    port.run(
      `INSERT OR IGNORE INTO state(id, mood, energy, relationship_stage, current_activity, short_term_goal, next_tick_at, updated_at)
       VALUES(1, 'neutral', 85, '初识', '待机中', '', NULL, ?)`,
      [Date.now()],
    )
  })
}

export function openRoleDb(roleId: string): RoleDbHandle {
  const { roleDir, folderName } = resolveRoleDbDir(roleId)
  const key = path.resolve(roleDir)
  const existing = openHandles.get(key)
  if (existing) return existing

  fs.mkdirSync(roleDir, { recursive: true })
  const dbFile = path.join(roleDir, 'memory.db')
  const port = new NodeSqlitePort(dbFile)
  try {
    verifyAndMigrateHandle(port, folderName)
  } catch (err) {
    try {
      port.raw.close()
    } catch {
      /* ignore close error after failed init */
    }
    throw err
  }

  const handle: RoleDbHandle = { roleId, folderName, roleDir, dbFile, port }
  openHandles.set(key, handle)
  return handle
}

/** 休眠角色时将 WAL 合并回单文件并释放连接，保证目录静态复制零丢数据 */
export function sleepRoleDb(roleId: string): void {
  const { roleDir } = resolveRoleDbDir(roleId)
  const key = path.resolve(roleDir)
  const handle = openHandles.get(key)
  if (!handle) return
  openHandles.delete(key)
  try {
    handle.port.close()
  } catch (err) {
    logger.warn('memory', `关闭角色记忆库失败 (${roleId}): ${getErrorMessage(err)}`)
  }
}

export function listOpenRoleHandles(): RoleDbHandle[] {
  return [...openHandles.values()]
}

export function findHandleByMemoryId(memoryId: string, preferredRoleId?: string): RoleDbHandle | null {
  if (preferredRoleId) {
    const preferred = openRoleDb(preferredRoleId)
    if (preferred.port.query('SELECT 1 FROM memories WHERE id = ? LIMIT 1', [memoryId]).length > 0) {
      return preferred
    }
  }
  for (const handle of openHandles.values()) {
    if (handle.port.query('SELECT 1 FROM memories WHERE id = ? LIMIT 1', [memoryId]).length > 0) {
      return handle
    }
  }
  const rolesRoot = path.join(ensureDataRoot(), 'roles')
  if (!fs.existsSync(rolesRoot)) return null
  for (const entry of fs.readdirSync(rolesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dbFile = path.join(rolesRoot, entry.name, 'memory.db')
    if (!fs.existsSync(dbFile)) continue
    const handle = openRoleDb(entry.name)
    if (handle.port.query('SELECT 1 FROM memories WHERE id = ? LIMIT 1', [memoryId]).length > 0) {
      return handle
    }
  }
  return null
}

export function prepareMemoryDb(dataRoot: string, backupRoot?: string): void {
  dataRootDir = dataRoot
  backupRootDir = backupRoot ?? path.join(dataRoot, 'backups')
  roleDirCache = null
  fs.mkdirSync(path.join(dataRootDir, 'roles'), { recursive: true })
  fs.mkdirSync(backupRootDir, { recursive: true })

  const legacyGlobalDb = path.join(dataRootDir, 'memory.db')
  const legacyBackup = path.join(backupRootDir, 'legacy-global-memory.db')
  if (fs.existsSync(legacyGlobalDb) && !fs.existsSync(legacyBackup)) {
    try {
      fs.copyFileSync(legacyGlobalDb, legacyBackup)
      logger.info('memory', `已保留并备份旧版全局记忆库: ${legacyBackup}`)
    } catch (err) {
      logger.warn('memory', `旧版全局记忆库备份失败: ${getErrorMessage(err)}`)
    }
  }
}

export function checkpoint(roleId?: string): void {
  if (roleId) {
    openRoleDb(roleId).port.checkpoint('PASSIVE')
    return
  }
  for (const handle of openHandles.values()) {
    handle.port.checkpoint('PASSIVE')
  }
}

export function closeMemoryDb(): void {
  for (const [key, handle] of openHandles.entries()) {
    openHandles.delete(key)
    try {
      handle.port.close()
    } catch {
      /* ignore */
    }
  }
  readyPromise = null
}

export function getRoleMeta(roleId: string, key: string): string | null {
  const found = openRoleDb(roleId).port.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])
  return found[0]?.value ?? null
}

export function setRoleMeta(roleId: string, key: string, value: string): void {
  openRoleDb(roleId).port.run('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)', [key, value])
}

const SYSTEM_META_ROLE = '_system'

export function getMeta(key: string, roleId = SYSTEM_META_ROLE): string | null {
  return getRoleMeta(roleId, key)
}

export function setMeta(key: string, value: string, roleId = SYSTEM_META_ROLE): void {
  setRoleMeta(roleId, key, value)
}
