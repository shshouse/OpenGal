import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

interface MemoryDbLogger {
  info(source: string, message: string): void
  warn(source: string, message: string): void
  error(source: string, message: string): void
}

let logger: MemoryDbLogger = {
  info: () => {},
  warn: (source, message) => console.warn(`[${source}] ${message}`),
  error: (source, message) => console.error(`[${source}] ${message}`),
}

export function setMemoryDbLogger(l: MemoryDbLogger): void {
  logger = l
}

// 原生 node:sqlite（Electron 35+ / Node 22.13+ 可用），WAL 增量落盘，写即持久。
// 旧方案（sql.js WASM + 3s 节流全量 export）已删；历史原因见 backups/memory-pre-wal.db。
export interface MessageRow {
  id?: number
  character_id: string
  role: string
  content: string
  ts: number
  archived: number
}

export interface FactRow {
  id: string
  character_id: string
  text: string
  entity: string
  importance: number
  confidence: number
  source: string
  created_at: string
  last_confirmed_at: string
  status: string
  evidence_reinforce: number
  evidence_negate: number
  protected_: number
}

export interface StoryRow {
  id: string
  character_id: string
  kind: string
  text: string
  occurred_at: string
  due_at: string | null
  fulfilled: number
  importance: number
  status: string
  created_at: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_msg_char ON messages(character_id, archived, ts);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  text TEXT NOT NULL,
  entity TEXT NOT NULL,
  importance INTEGER NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  evidence_reinforce INTEGER NOT NULL DEFAULT 0,
  evidence_negate INTEGER NOT NULL DEFAULT 0,
  protected_ INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_facts_char ON facts(character_id, status);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  due_at TEXT,
  fulfilled INTEGER NOT NULL DEFAULT 0,
  importance INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_char ON stories(character_id, status);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  text TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`

let db: DatabaseSync | null = null
let dbFile = ''
let readyPromise: Promise<void> | null = null

export function initMemoryDb(dataRoot: string): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = (async () => {
    fs.mkdirSync(dataRoot, { recursive: true })
    dbFile = path.join(dataRoot, 'memory.db')
    db = new DatabaseSync(dbFile)
    db.exec('PRAGMA journal_mode = WAL')
    const check = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
    if (check?.quick_check !== 'ok') {
      throw new Error(`memory.db 完整性检查失败: ${JSON.stringify(check)}`)
    }
    db.exec(SCHEMA)
    preMigrationBackup(dataRoot)
    checkpoint()
    snapshotBackup(dataRoot)
    syncLegacyMemoryFromJson(dataRoot)
    await syncChatHistoryFromJson(dataRoot)
    logger.info('memory', `记忆库已就绪(WAL): ${dbFile}`)
  })().catch((err) => {
    logger.error('memory', `记忆库初始化失败: ${(err as Error).message}`)
    throw err
  })
  return readyPromise
}

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

// 进程退出前调用，把 WAL 合并回主库（平时由 SQLite 自动 checkpoint）
export function flushMemoryDb(): void {
  checkpoint()
}

function checkpoint(): void {
  try {
    db?.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch (err) {
    logger.warn('memory', `checkpoint 失败: ${(err as Error).message}`)
  }
}

// 一次性迁移留档：旧 sql.js 引擎生成的文件在原生引擎首开前先备份一份，确认稳定后可删
function preMigrationBackup(dataRoot: string): void {
  try {
    if (getMeta('native_sqlite_migrated')) return
    const backupDir = path.join(dataRoot, 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const target = path.join(backupDir, 'memory-pre-wal.db')
    if (!fs.existsSync(target)) fs.copyFileSync(dbFile, target)
    setMeta('native_sqlite_migrated', new Date().toISOString())
    logger.info('memory', '已创建迁移前备份: backups/memory-pre-wal.db')
  } catch (err) {
    logger.warn('memory', `迁移前备份失败（不影响主库）: ${(err as Error).message}`)
  }
}

function snapshotBackup(dataRoot: string): void {
  try {
    if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size === 0) return
    const backupDir = path.join(dataRoot, 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    const target = path.join(backupDir, `memory-${day}.db`)
    if (!fs.existsSync(target)) fs.copyFileSync(dbFile, target)
    const all = fs.readdirSync(backupDir).filter((f) => f.startsWith('memory-')).sort()
    while (all.length > 3) fs.rmSync(path.join(backupDir, all.shift() as string), { force: true })
  } catch (err) {
    logger.warn('memory', `备份失败（不影响主库）: ${(err as Error).message}`)
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

function rows(query: string, params: SQLInputValue[] = []): Record<string, unknown>[] {
  if (!db) throw new Error('memoryDb 未初始化')
  return db.prepare(query).all(...params) as Record<string, unknown>[]
}

function run(query: string, params: SQLInputValue[] = []): void {
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

// ---- messages ----

export function listUnarchivedMessages(characterId: string): MessageRow[] {
  return rows(
    'SELECT id, character_id, role, content, ts, archived FROM messages WHERE character_id = ? AND archived = 0 ORDER BY ts, id',
    [characterId]
  ) as unknown as MessageRow[]
}

export function replaceUnarchivedMessages(characterId: string, items: Omit<MessageRow, 'id'>[]): void {
  withTx(() => {
    run('DELETE FROM messages WHERE character_id = ? AND archived = 0', [characterId])
    for (const item of items) {
      run('INSERT INTO messages(character_id, role, content, ts, archived) VALUES(?, ?, ?, ?, ?)', [
        characterId,
        item.role,
        item.content,
        item.ts,
        item.archived,
      ])
    }
  })
}

export function appendMessage(item: Omit<MessageRow, 'id'>): void {
  withTx(() => {
    run('INSERT INTO messages(character_id, role, content, ts, archived) VALUES(?, ?, ?, ?, ?)', [
      item.character_id,
      item.role,
      item.content,
      item.ts,
      item.archived,
    ])
  })
}

// 批量追加聊天消息（单事务），content 为完整消息对象 JSON
export function saveChatMessages(characterId: string, items: Array<{ role: string }>): void {
  if (items.length === 0) return
  const base = Date.now()
  withTx(() => {
    for (let i = 0; i < items.length; i++) {
      run('INSERT INTO messages(character_id, role, content, ts, archived) VALUES(?, ?, ?, ?, 0)', [
        characterId,
        items[i].role,
        JSON.stringify(items[i]),
        base + i,
      ])
    }
  })
}

// 锚点归档：把 [fromId..toId] 区间内的未归档消息标记 archived（原文保留）
export function archiveMessagesRange(characterId: string, fromId: number, toId: number): number {
  return withTx(() => {
    const info = db!.prepare(
      'UPDATE messages SET archived = 1 WHERE character_id = ? AND archived = 0 AND id >= ? AND id <= ?'
    ).run(characterId, fromId, toId)
    return Number(info.changes)
  })
}

// 取未归档消息的最新 id，作为下一次归档的锚点
export function latestMessageId(characterId: string): number | null {
  const found = rows('SELECT MAX(id) AS m FROM messages WHERE character_id = ? AND archived = 0', [characterId])
  const v = found[0]?.m
  return typeof v === 'number' ? v : null
}

export function clearCharacterMessages(characterId: string): void {
  withTx(() => {
    run('UPDATE messages SET archived = 1 WHERE character_id = ?', [characterId])
  })
}

// ---- 滚动摘要（L1 时间线，分段追加） ----

export interface SummaryRow {
  start_ts: number
  end_ts: number
  text: string
  message_count: number
}

export function listSummaries(characterId: string): SummaryRow[] {
  return rows(
    'SELECT start_ts, end_ts, text, message_count FROM summaries WHERE character_id = ? ORDER BY created_at',
    [characterId]
  ) as unknown as SummaryRow[]
}

export function addSummary(characterId: string, s: SummaryRow): void {
  withTx(() => {
    run(
      'INSERT INTO summaries(character_id, start_ts, end_ts, text, message_count, created_at) VALUES(?, ?, ?, ?, ?, ?)',
      [characterId, s.start_ts, s.end_ts, s.text, s.message_count, Date.now()]
    )
  })
}

// ---- facts ----

export function listFacts(characterId: string): FactRow[] {
  return rows('SELECT * FROM facts WHERE character_id = ? ORDER BY created_at, id', [
    characterId,
  ]) as unknown as FactRow[]
}

export function saveFacts(characterId: string, items: FactRow[]): void {
  withTx(() => {
    run('DELETE FROM facts WHERE character_id = ?', [characterId])
    for (const f of items) {
      run(
        `INSERT OR REPLACE INTO facts(id, character_id, text, entity, importance, confidence, source, created_at, last_confirmed_at, status, evidence_reinforce, evidence_negate, protected_)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          f.id,
          characterId,
          f.text,
          f.entity,
          f.importance,
          f.confidence,
          f.source,
          f.created_at,
          f.last_confirmed_at,
          f.status,
          f.evidence_reinforce,
          f.evidence_negate,
          f.protected_,
        ]
      )
    }
  })
}

// ---- stories ----

export function listStories(characterId: string): StoryRow[] {
  return rows('SELECT * FROM stories WHERE character_id = ? ORDER BY created_at, id', [
    characterId,
  ]) as unknown as StoryRow[]
}

export function saveStories(characterId: string, items: StoryRow[]): void {
  withTx(() => {
    run('DELETE FROM stories WHERE character_id = ?', [characterId])
    for (const s of items) {
      run(
        `INSERT OR REPLACE INTO stories(id, character_id, kind, text, occurred_at, due_at, fulfilled, importance, status, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, characterId, s.kind, s.text, s.occurred_at, s.due_at, s.fulfilled, s.importance, s.status, s.created_at]
      )
    }
  })
}

export function clearCharacterMemory(characterId: string): void {
  withTx(() => {
    run('DELETE FROM facts WHERE character_id = ?', [characterId])
    run('DELETE FROM stories WHERE character_id = ?', [characterId])
  })
}

// ---- 旧 JSON 记忆一次性迁移（JSON 原地保留，只读） ----

interface LegacyFactJson {
  id?: unknown
  text?: unknown
  entity?: unknown
  importance?: unknown
  confidence?: unknown
  source?: unknown
  created_at?: unknown
  last_confirmed_at?: unknown
  status?: unknown
  evidence?: { reinforce?: unknown; negate?: unknown }
}

interface LegacyStoryJson {
  id?: unknown
  kind?: unknown
  text?: unknown
  occurred_at?: unknown
  due_at?: unknown
  fulfilled?: unknown
  importance?: unknown
  status?: unknown
  created_at?: unknown
}

function intOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

function readJsonArray(file: string): unknown[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function syncLegacyMemoryFromJson(dataRoot: string): void {
  try {
    const root = path.join(dataRoot, 'memory')
    if (!fs.existsSync(root)) return
    for (const dirName of fs.readdirSync(root)) {
      const charDir = path.join(root, dirName)
      if (!fs.statSync(charDir).isDirectory()) continue
      const factsFile = path.join(charDir, 'facts.json')
      const storyFile = path.join(charDir, 'story.json')
      if (!fs.existsSync(factsFile) && !fs.existsSync(storyFile)) continue
      const marker = `legacy_mem:${dirName}`
      if (getMeta(marker)) continue
      const now = new Date().toISOString()
      let factCount = 0
      let storyCount = 0
      withTx(() => {
        for (const raw of readJsonArray(factsFile)) {
          const f = raw as LegacyFactJson
          if (typeof f.id !== 'string' || typeof f.text !== 'string' || !f.text) continue
          run(
            `INSERT OR REPLACE INTO facts(id, character_id, text, entity, importance, confidence, source, created_at, last_confirmed_at, status, evidence_reinforce, evidence_negate, protected_)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              f.id,
              dirName,
              f.text,
              typeof f.entity === 'string' ? f.entity : 'user',
              intOr(f.importance, 5),
              Number.isFinite(Number(f.confidence)) ? Number(f.confidence) : 0.5,
              typeof f.source === 'string' ? f.source : 'llm_inferred',
              typeof f.created_at === 'string' ? f.created_at : now,
              typeof f.last_confirmed_at === 'string' ? f.last_confirmed_at : now,
              f.status === 'active' ? 'active' : 'archived',
              intOr(f.evidence?.reinforce, 0),
              intOr(f.evidence?.negate, 0),
              f.source === 'manual' ? 1 : 0,
            ]
          )
          factCount++
        }
        for (const raw of readJsonArray(storyFile)) {
          const s = raw as LegacyStoryJson
          if (typeof s.id !== 'string' || typeof s.text !== 'string' || !s.text) continue
          run(
            `INSERT OR REPLACE INTO stories(id, character_id, kind, text, occurred_at, due_at, fulfilled, importance, status, created_at)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              s.id,
              dirName,
              typeof s.kind === 'string' ? s.kind : 'event',
              s.text,
              typeof s.occurred_at === 'string' ? s.occurred_at : now,
              typeof s.due_at === 'string' ? s.due_at : null,
              s.fulfilled === true ? 1 : 0,
              intOr(s.importance, 5),
              s.status === 'active' ? 'active' : 'archived',
              typeof s.created_at === 'string' ? s.created_at : now,
            ]
          )
          storyCount++
        }
        setMeta(marker, now)
      })
      if (factCount > 0 || storyCount > 0) {
        logger.info('memory', `已迁移旧记忆: ${dirName}（facts ${factCount} 条, stories ${storyCount} 条），原 JSON 保留未动`)
      }
    }
  } catch (err) {
    logger.warn('memory', `旧记忆迁移失败（原文件未动，下次启动重试）: ${(err as Error).message}`)
  }
}

// ---- chat_history JSON 同步（只读导入，JSON 保持原位） ----

interface LegacyChatFile {
  version?: number
  characterId?: string
  messages?: Array<{ role: string; content: unknown }>
}

async function syncChatHistoryFromJson(dataRoot: string): Promise<void> {
  try {
    const dir = path.join(dataRoot, 'chat_history')
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const file = path.join(dir, name)
      const mtime = String(Math.floor(fs.statSync(file).mtimeMs))
      const safeName = name.slice(0, -'.json'.length)
      if (getMeta(`chat_mtime:${safeName}`) === mtime) continue
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as LegacyChatFile
      const characterId = parsed?.characterId || safeName
      const msgs = Array.isArray(parsed?.messages) ? parsed.messages : []
      const mtimeMs = fs.statSync(file).mtimeMs
      const items = msgs.map((m, i) => ({
        character_id: characterId,
        role: m.role,
        content: JSON.stringify(m),
        ts: Math.max(0, Math.round(mtimeMs - (msgs.length - 1 - i) * 1000)),
        archived: 0,
      }))
      replaceUnarchivedMessages(characterId, items)
      setMeta(`chat_mtime:${safeName}`, mtime)
      logger.info('memory', `已同步会话历史到记忆库: ${characterId}（${items.length} 条）`)
    }
  } catch (err) {
    logger.warn('memory', `会话历史同步失败（原文件未动）: ${(err as Error).message}`)
  }
}
