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

// 原生 SQLite（Electron 内置 node:sqlite），WAL 模式，写即持久
export interface MessageRow {
  id?: number
  character_id: string
  role: string
  content: string
  ts: number
  archived: number
  kind?: string
}

export interface MemoryRow {
  id: string
  character_id: string
  kind: string
  text: string
  subject?: string | null
  attribute?: string | null
  object?: string | null
  polarity?: number | null
  entity?: string
  confidence?: number
  source?: string
  state: string
  importance: number
  happened_at: number | null
  created_at: number
  confirmed_at?: number | null
  source_from: number | null
  source_to: number | null
  supersedes: string | null
  pinned: number
  embedding: string | null
  valid_from?: string | null
  invalid_at?: string | null
  due_at?: string | null
  frozen_at?: string | null
  evidence?: string | null
}

const CJK_RE = /[㐀-鿿豈-﫿]/

/** 中文按相邻双字切词、英文与数字按整词；写入与查询必须使用同一套规则。 */
export function searchTokens(text: string): string[] {
  const parts = text.match(/[㐀-鿿豈-﫿]+|[A-Za-z0-9]+/g) ?? []
  const tokens: string[] = []
  for (const part of parts) {
    if (CJK_RE.test(part)) {
      if (part.length === 1) tokens.push(part)
      for (let i = 0; i + 1 < part.length; i++) tokens.push(part.slice(i, i + 2))
    } else {
      tokens.push(part.toLowerCase())
    }
  }
  return [...new Set(tokens)]
}

/** 消息 content 可能是完整消息 JSON，也可能是不带 JSON 的旧裸文本。 */
export function visibleMessageText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') return parsed
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw
    const content = (parsed as { content?: unknown }).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== 'object') return ''
          if ('text' in part) return String(part.text)
          if ('image_url' in part) return '[图片]'
          return ''
        })
        .filter(Boolean)
        .join(' ')
    }
    return raw
  } catch {
    return raw
  }
}

function indexMessage(id: number, content: string): void {
  run('DELETE FROM messages_fts WHERE rowid = ?', [id])
  run('INSERT INTO messages_fts(rowid, message_id, tokens) VALUES(?, ?, ?)', [
    id,
    id,
    searchTokens(visibleMessageText(content)).join(' '),
  ])
}

export interface FactRow {
  id: string
  character_id: string
  text: string
  entity: string
  subject: string | null
  attribute: string | null
  importance: number
  confidence: number
  source: string
  created_at: string
  last_confirmed_at: string
  status: string
  evidence_reinforce: number
  evidence_negate: number
  protected_: number
  valid_until: string | null
  frozen_at: string | null
  embedding: string | null
  source_evidence: string | null
  valid_from?: string | null
  invalid_at?: string | null
  superseded_by?: string | null
  object?: string | null
  polarity?: number | null
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
  source_evidence: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'chat'
);
CREATE INDEX IF NOT EXISTS idx_msg_char ON messages(character_id, archived, ts);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  text TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT 'user',
  subject TEXT,
  attribute TEXT,
  object TEXT,
  polarity INTEGER,
  confidence REAL NOT NULL DEFAULT 0.8,
  source TEXT NOT NULL DEFAULT 'llm_inferred',
  state TEXT NOT NULL DEFAULT 'active',
  importance INTEGER NOT NULL DEFAULT 3,
  happened_at INTEGER,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  source_from INTEGER,
  source_to INTEGER,
  supersedes TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  embedding TEXT,
  valid_from TEXT,
  invalid_at TEXT,
  due_at TEXT,
  frozen_at TEXT,
  evidence TEXT
);
CREATE INDEX IF NOT EXISTS idx_mem_char_state ON memories(character_id, state, kind);
CREATE INDEX IF NOT EXISTS idx_mem_char_time ON memories(character_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  message_id UNINDEXED,
  tokens
);
CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.id;
END;

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  text TEXT NOT NULL,
  entity TEXT NOT NULL,
  subject TEXT,
  attribute TEXT,
  object TEXT,
  polarity INTEGER NOT NULL DEFAULT 1,
  importance INTEGER NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  evidence_reinforce INTEGER NOT NULL DEFAULT 0,
  evidence_negate INTEGER NOT NULL DEFAULT 0,
  protected_ INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT,
  frozen_at TEXT,
  embedding TEXT,
  source_evidence TEXT,
  valid_from TEXT,
  invalid_at TEXT,
  superseded_by TEXT
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
  created_at TEXT NOT NULL,
  source_evidence TEXT
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
let backupRootDir = ''
let readyPromise: Promise<void> | null = null

export function initMemoryDb(dataRoot: string, backupRoot?: string): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = (async () => {
    fs.mkdirSync(dataRoot, { recursive: true })
    backupRootDir = backupRoot && backupRoot.trim() ? backupRoot : path.join(dataRoot, 'backups')
    fs.mkdirSync(backupRootDir, { recursive: true })
    migrateLegacyBackups(dataRoot)
    dbFile = path.join(dataRoot, 'memory.db')
    db = new DatabaseSync(dbFile)
    db.exec('PRAGMA journal_mode = WAL')
    const check = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
    if (check?.quick_check !== 'ok') {
      throw new Error(`memory.db 完整性检查失败: ${JSON.stringify(check)}`)
    }
    checkpoint()
    if (!preUpgradeBackup()) {
      throw new Error('升级前备份失败，已中止记忆库初始化')
    }
    db.exec(SCHEMA)
    migrateMessagesSchema()
    migrateFactsSchema()
    checkpoint()
    snapshotBackup()
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

// 进程退出前调用，把 WAL 合并回主库并补一份当日快照
export function flushMemoryDb(): void {
  checkpoint()
  snapshotBackup()
}

function checkpoint(): void {
  try {
    db?.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch (err) {
    logger.warn('memory', `checkpoint 失败: ${(err as Error).message}`)
  }
}

// 旧版备份留在 data/backups：首次启动时复制到新备份目录，原文件保留不动
function migrateLegacyBackups(dataRoot: string): void {
  try {
    const legacy = path.join(dataRoot, 'backups')
    if (path.resolve(legacy) === path.resolve(backupRootDir) || !fs.existsSync(legacy)) return
    for (const name of fs.readdirSync(legacy)) {
      if (!/^memory-.*\.db$/.test(name)) continue
      const target = path.join(backupRootDir, name)
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(legacy, name), target)
    }
    logger.info('memory', `旧备份已复制到 ${backupRootDir}（原文件保留）`)
  } catch (err) {
    logger.warn('memory', `旧备份迁移失败（不影响主库）: ${(err as Error).message}`)
  }
}

// 复制后立刻校验，坏备份等于没有备份
function verifyDbFile(file: string, requiredTable?: string): boolean {
  try {
    const probe = new DatabaseSync(file, { readOnly: true })
    try {
      const check = probe.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
      if (check?.quick_check !== 'ok') return false
      if (!requiredTable) return true
      const table = probe
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(requiredTable)
      return !!table
    } finally {
      probe.close()
    }
  } catch {
    return false
  }
}

function hasTable(name: string): boolean {
  return rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]).length > 0
}

// WAL 模式下直接复制主库会漏掉未 checkpoint 的数据；用 SQLite 自己的快照保证一致
function sqliteSnapshot(target: string, requiredTable?: string): boolean {
  if (!db) return false
  try {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true })
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    if (!verifyDbFile(target, requiredTable)) {
      fs.rmSync(target, { force: true })
      logger.error('memory', `备份校验失败，已删除: ${target}`)
      return false
    }
    return true
  } catch (err) {
    logger.error('memory', `备份生成失败: ${(err as Error).message}`)
    fs.rmSync(target, { force: true })
    return false
  }
}

// 在改表结构之前做一致性备份；备份失败必须阻断后续迁移
function preUpgradeBackup(): boolean {
  try {
    if (!hasTable('messages')) return true
    const target = path.join(backupRootDir, 'memory-pre-upgrade.db')
    if (fs.existsSync(target)) {
      if (verifyDbFile(target, 'messages')) return true
      fs.rmSync(target, { force: true })
    }
    if (!sqliteSnapshot(target, 'messages')) return false
    logger.info('memory', `已创建升级前备份: ${target}`)
    return true
  } catch (err) {
    logger.error('memory', `升级前备份失败: ${(err as Error).message}`)
    return false
  }
}

function snapshotBackup(): void {
  try {
    if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size === 0) return
    const day = new Date().toISOString().slice(0, 10)
    const target = path.join(backupRootDir, `memory-${day}.db`)
    const tmp = `${target}.tmp`
    if (!sqliteSnapshot(tmp)) return
    fs.rmSync(target, { force: true })
    fs.renameSync(tmp, target)
    const all = fs
      .readdirSync(backupRootDir)
      .filter((f) => /^memory-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
    while (all.length > 7) fs.rmSync(path.join(backupRootDir, all.shift() as string), { force: true })
  } catch (err) {
    logger.error('memory', `备份失败: ${(err as Error).message}`)
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

function ensureColumns(table: string, columns: Array<[string, string]>): void {
  const existing = rows(`PRAGMA table_info(${table})`, []).map((r) => String(r.name))
  for (const [name, ddl] of columns) {
    if (!existing.includes(name)) {
      db!.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`)
      logger.info('memory', `${table} 表新增列: ${name}`)
    }
  }
}

function migrateMessagesSchema(): void {
  try {
    const columns = rows('PRAGMA table_info(messages)', []).map((r) => String(r.name))
    if (!columns.includes('kind')) {
      db!.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'")
      logger.info('memory', 'messages 表新增列: kind')
    }
    ensureColumns('memories', [
      ['entity', "TEXT NOT NULL DEFAULT 'user'"],
      ['confidence', 'REAL NOT NULL DEFAULT 0.8'],
      ['source', "TEXT NOT NULL DEFAULT 'llm_inferred'"],
      ['due_at', 'TEXT'],
      ['frozen_at', 'TEXT'],
      ['evidence', 'TEXT'],
      ['subject', 'TEXT'],
      ['attribute', 'TEXT'],
      ['object', 'TEXT'],
      ['polarity', 'INTEGER'],
      ['confirmed_at', 'INTEGER'],
      ['valid_from', 'TEXT'],
      ['invalid_at', 'TEXT'],
    ])
    const indexed = new Set(rows('SELECT rowid FROM messages_fts', []).map((r) => Number(r.rowid)))
    const pending = rows('SELECT id, content FROM messages', []).filter((r) => !indexed.has(Number(r.id)))
    if (pending.length > 0) {
      withTx(() => {
        for (const row of pending) indexMessage(Number(row.id), String(row.content))
      })
      logger.info('memory', `已补建全文索引: ${pending.length} 条消息`)
    }
  } catch (err) {
    logger.error('memory', `messages schema 迁移失败: ${(err as Error).message}`)
    throw err
  }
}

function migrateLegacyMemoryTables(): void {
  try {
    const existing = Number(rows('SELECT COUNT(*) AS c FROM memories', [])[0]?.c ?? 0)
    if (existing > 0) return
    const hasTable = (name: string) =>
      rows("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]).length > 0
    let migrated = 0
    withTx(() => {
      if (hasTable('facts')) {
        for (const row of rows('SELECT * FROM facts', [])) {
          const fact = row as unknown as FactRow
          insertMemoryRowRaw(characterIdOf(fact), factRowToMemory(characterIdOf(fact), fact))
          migrated++
        }
      }
      if (hasTable('stories')) {
        for (const row of rows('SELECT * FROM stories', [])) {
          const story = row as unknown as StoryRow
          insertMemoryRowRaw(characterIdOf(story), storyRowToMemory(characterIdOf(story), story))
          migrated++
        }
      }
    })
    if (migrated > 0) logger.info('memory', `旧 facts/stories 已迁移到 memories: ${migrated} 条`)
  } catch (err) {
    logger.warn('memory', `旧记忆表迁移失败（原表保留，不影响启动）: ${(err as Error).message}`)
  }
}

function characterIdOf(row: { character_id: string }): string {
  return row.character_id
}

function migrateFactsSchema(): void {
  try {
    const factColumns = rows('PRAGMA table_info(facts)', []).map((r) => String(r.name))
    const storyColumns = rows('PRAGMA table_info(stories)', []).map((r) => String(r.name))
    const additions: Array<[string, string]> = [
      ['valid_until', 'TEXT'],
      ['frozen_at', 'TEXT'],
      ['embedding', 'TEXT'],
      ['source_evidence', 'TEXT'],
      ['subject', 'TEXT'],
      ['attribute', 'TEXT'],
      ['object', 'TEXT'],
      ['polarity', 'INTEGER NOT NULL DEFAULT 1'],
      ['valid_from', 'TEXT'],
      ['invalid_at', 'TEXT'],
      ['superseded_by', 'TEXT'],
    ]
    const missing = additions.filter(([name]) => !factColumns.includes(name))
    const needStoryEvidence = !storyColumns.includes('source_evidence')
    if (missing.length === 0 && !needStoryEvidence) return
    const target = path.join(
      backupRootDir,
      `memory-pre-schema-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
    )
    migrateLegacyMemoryTables()
    if (!sqliteSnapshot(target, 'facts')) {
      throw new Error('schema 迁移前备份失败，已中止迁移')
    }
    logger.info('memory', `已创建 schema 迁移前备份: ${target}`)
    const all = fs
      .readdirSync(backupRootDir)
      .filter((f) => /^memory-pre-schema-/.test(f) && f.endsWith('.db'))
      .sort()
    while (all.length > 3) fs.rmSync(path.join(backupRootDir, all.shift() as string), { force: true })
    withTx(() => {
      for (const [name, type] of missing) {
        db!.exec(`ALTER TABLE facts ADD COLUMN ${name} ${type}`)
        logger.info('memory', `facts 表新增列: ${name}`)
      }
      if (needStoryEvidence) {
        db!.exec('ALTER TABLE stories ADD COLUMN source_evidence TEXT')
        logger.info('memory', 'stories 表新增列: source_evidence')
      }
      setMeta('facts_schema_migrated', new Date().toISOString())
    })
  } catch (err) {
    logger.error('memory', `facts schema 迁移失败: ${(err as Error).message}`)
    throw err
  }
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

export function replaceUnarchivedMessages(
  characterId: string,
  items: Array<Omit<MessageRow, 'id'> & { id?: number }>,
): void {
  withTx(() => {
    run('DELETE FROM messages WHERE character_id = ? AND archived = 0', [characterId])
    for (const item of items) {
      if (typeof item.id === 'number') {
        run(
          'INSERT OR REPLACE INTO messages(id, character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, ?, ?, ?)',
          [item.id, characterId, item.role, item.content, item.ts, item.archived, item.kind ?? 'chat']
        )
        indexMessage(item.id, item.content)
      } else {
        const info = db!
          .prepare('INSERT INTO messages(character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, ?, ?)')
          .run(characterId, item.role, item.content, item.ts, item.archived, item.kind ?? 'chat')
        indexMessage(Number(info.lastInsertRowid), item.content)
      }
    }
  })
}

export function appendMessage(item: Omit<MessageRow, 'id'>): void {
  withTx(() => {
    const info = db!
      .prepare('INSERT INTO messages(character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, ?, ?)')
      .run(item.character_id, item.role, item.content, item.ts, item.archived, item.kind ?? 'chat')
    indexMessage(Number(info.lastInsertRowid), item.content)
  })
}

// 旧会话导入只追加缺失项，不触碰现有消息；判重键与导入时生成的时间戳一致，重复导入幂等
export function appendMissingMessages(
  characterId: string,
  items: Array<Omit<MessageRow, 'id'>>,
): number {
  let inserted = 0
  withTx(() => {
    const exists = db!.prepare(
      'SELECT 1 FROM messages WHERE character_id = ? AND role = ? AND content = ? AND ts = ? LIMIT 1'
    )
    const insert = db!.prepare(
      'INSERT INTO messages(character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, ?, ?)'
    )
    for (const item of items) {
      if (exists.get(characterId, item.role, item.content, item.ts)) continue
      const info = insert.run(characterId, item.role, item.content, item.ts, item.archived, item.kind ?? 'chat')
      indexMessage(Number(info.lastInsertRowid), item.content)
      inserted++
    }
  })
  return inserted
}

const MESSAGE_COLUMNS = 'id, character_id, role, content, ts, archived, kind'

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

// 中文按整句入索引时无法分词，这里按角色过滤后做子串匹配；命中含已归档消息，并补前后邻段避免断章取义
export function searchMessageContext(
  characterId: string,
  query: string,
  limit = 3,
  radius = 1,
): MessageRow[] {
  return searchMessagesInternal(characterId, query, limit, radius)
}

// 限定时间范围检索，供回溯"某段时间说过什么"
export function searchMessagesInRange(
  characterId: string,
  query: string,
  fromTs: number,
  toTs: number,
  limit = 3,
  radius = 1,
): MessageRow[] {
  return searchMessagesInternal(characterId, query, limit, radius, fromTs, toTs)
}

function searchMessagesInternal(
  characterId: string,
  query: string,
  limit: number,
  radius: number,
  fromTs?: number,
  toTs?: number,
): MessageRow[] {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const range = fromTs !== undefined && toTs !== undefined
  const rangeParams = range ? [fromTs as number, toTs as number] : []
  const hits: MessageRow[] = []

  const tokens = searchTokens(query)
  if (tokens.length > 0) {
    const match = tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ')
    const found = rows(
      `SELECT m.id, m.character_id, m.role, m.content, m.ts, m.archived, m.kind
       FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ? AND m.character_id = ?${range ? ' AND m.ts >= ? AND m.ts <= ?' : ''}
       ORDER BY bm25(messages_fts) LIMIT ?`,
      [match, characterId, ...rangeParams, limit]
    ) as unknown as MessageRow[]
    for (const row of found) {
      if (terms.every((term) => visibleMessageText(String(row.content)).includes(term))) hits.push(row)
    }
  }

  // 单字与短词不会被相邻双字索引覆盖，用子串兜底
  if (hits.length === 0) {
    const where = terms.map(() => "content LIKE ? ESCAPE '\\'").join(' AND ')
    const fallback = rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND ${where}${range ? ' AND ts >= ? AND ts <= ?' : ''} ORDER BY ts DESC, id DESC LIMIT ?`,
      [characterId, ...terms.map(likePattern), ...rangeParams, limit]
    ) as unknown as MessageRow[]
    hits.push(...fallback)
  }

  return expandNeighbors(characterId, hits, radius, fromTs, toTs)
}

function expandNeighbors(
  characterId: string,
  hits: MessageRow[],
  radius: number,
  fromTs?: number,
  toTs?: number,
): MessageRow[] {
  const range = fromTs !== undefined && toTs !== undefined
  const rangeSql = range ? ' AND ts >= ? AND ts <= ?' : ''
  const rangeParams = range ? [fromTs as number, toTs as number] : []
  const found = new Map<number, MessageRow>()
  for (const hit of hits) {
    const id = hit.id as number
    found.set(id, hit)
    if (radius <= 0) continue
    const before = rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND id < ?${rangeSql} ORDER BY id DESC LIMIT ?`,
      [characterId, id, ...rangeParams, radius]
    ) as unknown as MessageRow[]
    const after = rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND id > ?${rangeSql} ORDER BY id ASC LIMIT ?`,
      [characterId, id, ...rangeParams, radius]
    ) as unknown as MessageRow[]
    for (const row of [...before, ...after]) found.set(row.id as number, row)
  }
  return [...found.values()].sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0))
}

export interface MessageSearchOptions {
  fromTs?: number
  toTs?: number
  limit?: number
  radius?: number
}

/** 中文原文检索：先走相邻双字索引，未命中再退回子串；结果含相邻上下文。 */
export function searchMessages(
  characterId: string,
  query: string,
  opts: MessageSearchOptions = {},
): MessageRow[] {
  return searchMessagesInternal(characterId, query, opts.limit ?? 3, opts.radius ?? 1, opts.fromTs, opts.toTs)
}

// ---- memories：长期记忆单表 ----

function insertMemoryRowRaw(characterId: string, row: MemoryRow): void {
  run(
      `INSERT OR REPLACE INTO memories(id, character_id, kind, text, entity, subject, attribute, object, polarity, confidence, source, state, importance, happened_at, created_at, confirmed_at, source_from, source_to, supersedes, pinned, embedding, valid_from, invalid_at, due_at, frozen_at, evidence)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        characterId,
        row.kind,
        row.text,
        row.entity ?? 'user',
        row.subject ?? null,
        row.attribute ?? null,
        row.object ?? null,
        row.polarity ?? null,
        row.confidence ?? 0.8,
        row.source ?? 'llm_inferred',
        row.state,
        row.importance,
        row.happened_at,
        row.created_at,
        row.confirmed_at ?? null,
        row.source_from,
        row.source_to,
        row.supersedes,
        row.pinned,
        row.embedding,
        row.valid_from ?? null,
        row.invalid_at ?? null,
        row.due_at ?? null,
        row.frozen_at ?? null,
        row.evidence ?? null,
      ]
    )
}

export function insertMemoryRow(characterId: string, row: MemoryRow): void {
  withTx(() => insertMemoryRowRaw(characterId, row))
}

export function listMemoryRows(
  characterId: string,
  opts: { includeInactive?: boolean } = {},
): MemoryRow[] {
  const filter = opts.includeInactive ? '' : " AND state = 'active'"
  return rows(
    `SELECT * FROM memories WHERE character_id = ?${filter} ORDER BY created_at DESC, id`,
    [characterId]
  ) as unknown as MemoryRow[]
}

export function setMemoryStateRow(id: string, state: string): number {
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET state = ? WHERE id = ?').run(state, id).changes
  ))
}

export function setMemoryPinnedRow(id: string, pinned: boolean): number {
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id).changes
  ))
}

export function setMemoryEmbeddingRow(id: string, embedding: string): number {
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(embedding, id).changes
  ))
}

export function confirmMemoryRow(id: string, ts: number): number {
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET confirmed_at = ? WHERE id = ?').run(ts, id).changes
  ))
}

export function deleteMemoryRow(id: string): number {
  return withTx(() => Number(
    db!.prepare('DELETE FROM memories WHERE id = ?').run(id).changes
  ))
}

export function clearCharacterMemories(characterId: string): void {
  withTx(() => {
    run('DELETE FROM memories WHERE character_id = ?', [characterId])
  })
}

// 按时间范围取原话，用于从记忆回溯到当天的对话
export function messagesInRange(characterId: string, fromTs: number, toTs: number): MessageRow[] {
  return rows(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND ts >= ? AND ts <= ? ORDER BY ts, id`,
    [characterId, fromTs, toTs]
  ) as unknown as MessageRow[]
}

// 批量追加聊天消息（单事务），content 为完整消息对象 JSON
export function saveChatMessages(characterId: string, items: Array<{ role: string }>): number[] {
  if (items.length === 0) return []
  const base = Date.now()
  const ids: number[] = []
  withTx(() => {
    for (let i = 0; i < items.length; i++) {
      const info = db!
        .prepare('INSERT INTO messages(character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, 0, ?)')
        .run(characterId, items[i].role, JSON.stringify(items[i]), base + i, 'chat')
      ids.push(Number(info.lastInsertRowid))
      indexMessage(Number(info.lastInsertRowid), JSON.stringify(items[i]))
    }
  })
  return ids
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

// 摘要与归档必须同一个事务：先归档，归档 0 行说明区间已处理过，不能再插摘要
export function commitCompression(
  characterId: string,
  fromId: number,
  toId: number,
  summary: { text: string; message_count: number; start_ts: number; end_ts: number },
): { archived: number } {
  return withTx(() => {
    const info = db!.prepare(
      'UPDATE messages SET archived = 1 WHERE character_id = ? AND archived = 0 AND id >= ? AND id <= ?'
    ).run(characterId, fromId, toId)
    const archived = Number(info.changes)
    if (archived === 0) return { archived }
    db!.prepare(
      'INSERT INTO summaries(character_id, start_ts, end_ts, text, message_count, created_at) VALUES(?, ?, ?, ?, ?, ?)'
    ).run(characterId, summary.start_ts, summary.end_ts, summary.text, summary.message_count, Date.now())
    return { archived }
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

// ---- facts / stories：统一落在 memories 单表 ----

function msToIso(ms: number): string {
  return new Date(ms).toISOString()
}

function isoToMs(iso: string, fallback = Date.now()): number {
  const value = Date.parse(iso)
  return Number.isFinite(value) ? value : fallback
}

function evidenceRange(raw: string | null | undefined): { fromTs?: number; toTs?: number } {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as { fromTs?: number; toTs?: number }
  } catch {
    return {}
  }
}

function factRowToMemory(characterId: string, f: FactRow): MemoryRow {
  const range = evidenceRange(f.source_evidence)
  return {
    id: f.id,
    character_id: characterId,
    kind: 'fact',
    text: f.text,
    entity: f.entity,
    subject: f.subject ?? null,
    attribute: f.attribute ?? null,
    object: f.object ?? null,
    polarity: f.polarity ?? 1,
    confidence: f.confidence,
    source: f.source,
    state: f.status,
    importance: f.importance,
    happened_at: null,
    created_at: isoToMs(f.created_at),
    confirmed_at: isoToMs(f.last_confirmed_at),
    source_from: range.fromTs ?? null,
    source_to: range.toTs ?? null,
    supersedes: null,
    pinned: f.protected_ === 1 || f.frozen_at ? 1 : 0,
    embedding: f.embedding,
    valid_from: f.valid_from ?? null,
    invalid_at: f.invalid_at ?? f.valid_until ?? null,
    due_at: null,
    frozen_at: f.frozen_at,
    evidence: f.source_evidence,
  }
}

function memoryToFactRow(r: MemoryRow): FactRow {
  const pinned = r.pinned === 1
  return {
    id: r.id,
    character_id: r.character_id,
    text: r.text,
    entity: (r.entity ?? 'user') as FactRow['entity'],
    subject: r.subject ?? null,
    attribute: r.attribute ?? null,
    object: r.object ?? null,
    polarity: r.polarity ?? 1,
    importance: r.importance,
    confidence: r.confidence ?? 0.8,
    source: r.source ?? 'llm_inferred',
    created_at: msToIso(r.created_at),
    last_confirmed_at: msToIso(r.confirmed_at ?? r.created_at),
    status: r.state,
    evidence_reinforce: 0,
    evidence_negate: 0,
    protected_: pinned ? 1 : 0,
    valid_until: r.invalid_at ?? null,
    frozen_at: r.frozen_at ?? (pinned ? msToIso(r.confirmed_at ?? r.created_at) : null),
    embedding: r.embedding,
    source_evidence:
      r.evidence ??
      (r.source_from !== null && r.source_to !== null
        ? JSON.stringify({ fromTs: r.source_from, toTs: r.source_to })
        : null),
    valid_from: r.valid_from ?? null,
    invalid_at: r.invalid_at ?? null,
    superseded_by: null,
  }
}

function storyRowToMemory(characterId: string, s: StoryRow): MemoryRow {
  const range = evidenceRange(s.source_evidence)
  return {
    id: s.id,
    character_id: characterId,
    kind: s.kind,
    text: s.text,
    state: s.status === 'active' ? (s.fulfilled === 1 ? 'fulfilled' : 'active') : 'archived',
    importance: s.importance,
    happened_at: isoToMs(s.occurred_at),
    created_at: isoToMs(s.created_at),
    source_from: range.fromTs ?? null,
    source_to: range.toTs ?? null,
    supersedes: null,
    pinned: 0,
    embedding: null,
    due_at: s.due_at,
    frozen_at: null,
    evidence: s.source_evidence,
  }
}

function memoryToStoryRow(r: MemoryRow): StoryRow {
  const inactive = r.state === 'archived' || r.state === 'cancelled' || r.state === 'superseded'
  return {
    id: r.id,
    character_id: r.character_id,
    kind: r.kind,
    text: r.text,
    occurred_at: msToIso(r.happened_at ?? r.created_at),
    due_at: r.due_at ?? null,
    fulfilled: r.state === 'fulfilled' ? 1 : 0,
    importance: r.importance,
    status: inactive ? 'archived' : 'active',
    created_at: msToIso(r.created_at),
    source_evidence:
      r.evidence ??
      (r.source_from !== null && r.source_to !== null
        ? JSON.stringify({ fromTs: r.source_from, toTs: r.source_to })
        : null),
  }
}

export function listFacts(characterId: string): FactRow[] {
  return listMemoryRows(characterId, { includeInactive: true })
    .filter((row) => row.kind === 'fact')
    .map(memoryToFactRow)
}

export function saveFacts(characterId: string, items: FactRow[]): void {
  withTx(() => {
    run("DELETE FROM memories WHERE character_id = ? AND kind = 'fact'", [characterId])
    for (const item of items) insertMemoryRowRaw(characterId, factRowToMemory(characterId, item))
  })
}

export function insertFactRow(characterId: string, f: FactRow): void {
  insertMemoryRow(characterId, factRowToMemory(characterId, f))
}

export function getFactRow(id: string): FactRow | null {
  const found = rows('SELECT * FROM memories WHERE id = ?', [id])
  return found.length > 0 ? memoryToFactRow(found[0] as unknown as MemoryRow) : null
}

export function reinforceFactRow(id: string, ts: string): number {
  return confirmMemoryRow(id, isoToMs(ts))
}

export function negateFactRow(id: string): number {
  return setMemoryStateRow(id, 'archived')
}

export function setFactStatusRow(id: string, status: string): number {
  return setMemoryStateRow(id, status)
}

export function setFactFrozenRow(id: string, frozenAt: string | null): number {
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET frozen_at = ?, pinned = ? WHERE id = ?')
      .run(frozenAt, frozenAt ? 1 : 0, id).changes
  ))
}

export function setFactEmbeddingRow(id: string, embedding: string): number {
  return setMemoryEmbeddingRow(id, embedding)
}

export function deleteFactRow(id: string): number {
  return deleteMemoryRow(id)
}

export function listStories(characterId: string): StoryRow[] {
  return listMemoryRows(characterId, { includeInactive: true })
    .filter((row) => row.kind !== 'fact')
    .map(memoryToStoryRow)
}

export function saveStories(characterId: string, items: StoryRow[]): void {
  withTx(() => {
    run("DELETE FROM memories WHERE character_id = ? AND kind != 'fact'", [characterId])
    for (const item of items) insertMemoryRowRaw(characterId, storyRowToMemory(characterId, item))
  })
}

export function insertStoryRow(characterId: string, s: StoryRow): void {
  insertMemoryRow(characterId, storyRowToMemory(characterId, s))
}

export function setStoryStatusRow(id: string, status: string): number {
  return setMemoryStateRow(id, status)
}

export function clearCharacterMemory(characterId: string): void {
  clearCharacterMemories(characterId)
}

// ---- 提取游标与来源追踪 ----

// 游标 = 已经提取过的最后一条消息时间。原文在库，游标在库，重启才能续上
export function getMemoryCursor(characterId: string): number {
  const raw = getMeta(`memory.cursor.${characterId}`)
  const parsed = raw ? Number(raw) : 0
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

export function setMemoryCursor(characterId: string, ts: number): void {
  setMeta(`memory.cursor.${characterId}`, String(Math.max(0, Math.floor(ts))))
}

// 第一次使用游标时不要回放整段历史：只回溯最近 N 条，避免升级后一次性重拉所有对话
export function isCursorInitialized(characterId: string): boolean {
  return getMeta(`memory.cursor.init.${characterId}`) === '1'
}

export function markCursorInitialized(characterId: string): void {
  setMeta(`memory.cursor.init.${characterId}`, '1')
}

export function bootstrapCursor(characterId: string, lookback: number): number {
  const found = rows(
    'SELECT ts FROM messages WHERE character_id = ? ORDER BY ts DESC LIMIT 1 OFFSET ?',
    [characterId, Math.max(0, lookback)],
  )
  return found.length > 0 ? Number(found[0].ts) : 0
}

// 一批记忆对应的原文消息 id：用于回查“这条记忆是从哪句话来的”
export function listMessageIdsInRange(characterId: string, fromTs: number, toTs: number): number[] {
  return rows(
    'SELECT id FROM messages WHERE character_id = ? AND ts >= ? AND ts <= ? ORDER BY ts, id',
    [characterId, fromTs, toTs],
  ).map((row) => Number(row.id))
}

export function listMessagesAfter(characterId: string, afterTs: number, limit: number): MessageRow[] {
  return rows(
    'SELECT id, character_id, role, content, ts, archived FROM messages WHERE character_id = ? AND ts > ? ORDER BY ts, id LIMIT ?',
    [characterId, afterTs, Math.max(1, limit)],
  ) as unknown as MessageRow[]
}

// 重建前清空抽取层；原文、聊天记录、摘要都不动（摘要由压缩链路单独维护）
export function resetDerived(characterId: string): { facts: number, stories: number } {
  return withTx(() => ({
    facts: Number(db!.prepare("DELETE FROM memories WHERE character_id = ? AND kind = 'fact'").run(characterId).changes),
    stories: Number(db!.prepare("DELETE FROM memories WHERE character_id = ? AND kind != 'fact'").run(characterId).changes),
  }))
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
          insertMemoryRowRaw(dirName, {
            id: f.id,
            character_id: dirName,
            kind: 'fact',
            text: f.text,
            entity: typeof f.entity === 'string' ? f.entity : 'user',
            importance: intOr(f.importance, 5),
            confidence: Number.isFinite(Number(f.confidence)) ? Number(f.confidence) : 0.5,
            source: typeof f.source === 'string' ? f.source : 'llm_inferred',
            state: f.status === 'active' ? 'active' : 'archived',
            happened_at: null,
            created_at: isoToMs(typeof f.created_at === 'string' ? f.created_at : now),
            confirmed_at: isoToMs(typeof f.last_confirmed_at === 'string' ? f.last_confirmed_at : now),
            source_from: null,
            source_to: null,
            supersedes: null,
            pinned: f.source === 'manual' ? 1 : 0,
            embedding: null,
          })
          factCount++
        }
        for (const raw of readJsonArray(storyFile)) {
          const s = raw as LegacyStoryJson
          if (typeof s.id !== 'string' || typeof s.text !== 'string' || !s.text) continue
          insertMemoryRowRaw(dirName, {
            id: s.id,
            character_id: dirName,
            kind: typeof s.kind === 'string' ? s.kind : 'event',
            text: s.text,
            state: s.fulfilled ? 'fulfilled' : (s.status === 'active' ? 'active' : 'archived'),
            importance: intOr(s.importance, 5),
            happened_at: isoToMs(typeof s.occurred_at === 'string' ? s.occurred_at : now),
            created_at: isoToMs(typeof s.created_at === 'string' ? s.created_at : now),
            source_from: null,
            source_to: null,
            supersedes: null,
            pinned: 0,
            embedding: null,
            due_at: typeof s.due_at === 'string' ? s.due_at : null,
          })
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
      appendMissingMessages(characterId, items)
      setMeta(`chat_mtime:${safeName}`, mtime)
      logger.info('memory', `已同步会话历史到记忆库: ${characterId}（${items.length} 条）`)
    }
  } catch (err) {
    logger.warn('memory', `会话历史同步失败（原文件未动）: ${(err as Error).message}`)
  }
}
