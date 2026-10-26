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
  valid_until: string | null
  frozen_at: string | null
  embedding: string | null
  source_evidence: string | null
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
  protected_ INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT,
  frozen_at TEXT,
  embedding TEXT,
  source_evidence TEXT
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

function migrateFactsSchema(): void {
  try {
    const existing = rows("PRAGMA table_info(facts)", []).map((r) => String(r.name))
    const needValidUntil = !existing.includes('valid_until')
    const needFrozenAt = !existing.includes('frozen_at')
    const needEmbedding = !existing.includes('embedding')
    const needEvidence = !existing.includes('source_evidence')
    const storyColumns = rows('PRAGMA table_info(stories)', []).map((r) => String(r.name))
    const needStoryEvidence = !storyColumns.includes('source_evidence')
    if (!needValidUntil && !needFrozenAt && !needEmbedding && !needEvidence && !needStoryEvidence) return
    const target = path.join(
      backupRootDir,
      `memory-pre-schema-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
    )
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
      if (needValidUntil) {
        db!.exec('ALTER TABLE facts ADD COLUMN valid_until TEXT')
        logger.info('memory', 'facts 表新增列: valid_until')
      }
      if (needFrozenAt) {
        db!.exec('ALTER TABLE facts ADD COLUMN frozen_at TEXT')
        logger.info('memory', 'facts 表新增列: frozen_at')
      }
      if (needEmbedding) {
        db!.exec('ALTER TABLE facts ADD COLUMN embedding TEXT')
        logger.info('memory', 'facts 表新增列: embedding')
      }
      if (needEvidence) {
        db!.exec('ALTER TABLE facts ADD COLUMN source_evidence TEXT')
        logger.info('memory', 'facts 表新增列: source_evidence')
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
          'INSERT OR REPLACE INTO messages(id, character_id, role, content, ts, archived) VALUES(?, ?, ?, ?, ?, ?)',
          [item.id, characterId, item.role, item.content, item.ts, item.archived]
        )
      } else {
        run('INSERT INTO messages(character_id, role, content, ts, archived) VALUES(?, ?, ?, ?, ?)', [
          characterId,
          item.role,
          item.content,
          item.ts,
          item.archived,
        ])
      }
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
      'INSERT INTO messages(character_id, role, content, ts, archived) VALUES(?, ?, ?, ?, ?)'
    )
    for (const item of items) {
      if (exists.get(characterId, item.role, item.content, item.ts)) continue
      insert.run(characterId, item.role, item.content, item.ts, item.archived)
      inserted++
    }
  })
  return inserted
}

const MESSAGE_COLUMNS = 'id, character_id, role, content, ts, archived'

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
  const where = terms.map(() => "content LIKE ? ESCAPE '\\'").join(' AND ')
  const range = fromTs !== undefined && toTs !== undefined ? ' AND ts >= ? AND ts <= ?' : ''
  const params: SQLInputValue[] = [characterId, ...terms.map(likePattern)]
  if (range) params.push(fromTs as number, toTs as number)
  const hits = rows(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND ${where}${range} ORDER BY ts DESC, id DESC LIMIT ?`,
    [...params, limit]
  ) as unknown as MessageRow[]
  const found = new Map<number, MessageRow>()
  for (const hit of hits) {
    const id = hit.id as number
    found.set(id, hit)
    if (radius <= 0) continue
    const before = rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND id < ?${range} ORDER BY id DESC LIMIT ?`,
      [characterId, id, ...(range ? [fromTs as number, toTs as number] : []), radius]
    ) as unknown as MessageRow[]
    const after = rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND id > ?${range} ORDER BY id ASC LIMIT ?`,
      [characterId, id, ...(range ? [fromTs as number, toTs as number] : []), radius]
    ) as unknown as MessageRow[]
    for (const row of [...before, ...after]) found.set(row.id as number, row)
  }
  return [...found.values()].sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0))
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
        .prepare('INSERT INTO messages(character_id, role, content, ts, archived) VALUES(?, ?, ?, ?, 0)')
        .run(characterId, items[i].role, JSON.stringify(items[i]), base + i)
      ids.push(Number(info.lastInsertRowid))
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
        `INSERT OR REPLACE INTO facts(id, character_id, text, entity, importance, confidence, source, created_at, last_confirmed_at, status, evidence_reinforce, evidence_negate, protected_, valid_until, frozen_at, embedding)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          f.valid_until,
          f.frozen_at,
          f.embedding,
        ]
      )
    }
  })
}

// ---- facts：单实体增量写（避免整表读改写互相覆盖） ----

export function insertFactRow(characterId: string, f: FactRow): void {
  withTx(() => {
    run(
      `INSERT OR REPLACE INTO facts(id, character_id, text, entity, importance, confidence, source, created_at, last_confirmed_at, status, evidence_reinforce, evidence_negate, protected_, valid_until, frozen_at, embedding, source_evidence)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        f.valid_until,
        f.frozen_at,
        f.embedding,
        f.source_evidence,
      ]
    )
  })
}

export function getFactRow(id: string): FactRow | null {
  const found = rows('SELECT * FROM facts WHERE id = ?', [id])
  return found.length > 0 ? (found[0] as unknown as FactRow) : null
}

export function reinforceFactRow(id: string, ts: string): number {
  return withTx(() => Number(
    db!.prepare('UPDATE facts SET last_confirmed_at = ?, evidence_reinforce = evidence_reinforce + 1 WHERE id = ?')
      .run(ts, id).changes
  ))
}

export function negateFactRow(id: string): number {
  return withTx(() => Number(
    db!.prepare("UPDATE facts SET status = 'archived', evidence_negate = evidence_negate + 1 WHERE id = ?")
      .run(id).changes
  ))
}

export function setFactStatusRow(id: string, status: string): number {
  return withTx(() => Number(
    db!.prepare('UPDATE facts SET status = ? WHERE id = ?').run(status, id).changes
  ))
}

export function setFactFrozenRow(id: string, frozenAt: string | null): number {
  return withTx(() => Number(
    db!.prepare('UPDATE facts SET frozen_at = ? WHERE id = ?').run(frozenAt, id).changes
  ))
}

export function setFactEmbeddingRow(id: string, embedding: string): number {
  return withTx(() => Number(
    db!.prepare('UPDATE facts SET embedding = ? WHERE id = ?').run(embedding, id).changes
  ))
}

export function deleteFactRow(id: string): number {
  return withTx(() => Number(
    db!.prepare('DELETE FROM facts WHERE id = ?').run(id).changes
  ))
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

// ---- stories：单实体增量写 ----

export function insertStoryRow(characterId: string, s: StoryRow): void {
  withTx(() => {
    run(
      `INSERT OR REPLACE INTO stories(id, character_id, kind, text, occurred_at, due_at, fulfilled, importance, status, created_at, source_evidence)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, characterId, s.kind, s.text, s.occurred_at, s.due_at, s.fulfilled, s.importance, s.status, s.created_at, s.source_evidence]
    )
  })
}

export function setStoryStatusRow(id: string, status: string): number {
  return withTx(() => Number(
    db!.prepare('UPDATE stories SET status = ? WHERE id = ?').run(status, id).changes
  ))
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
            `INSERT OR REPLACE INTO facts(id, character_id, text, entity, importance, confidence, source, created_at, last_confirmed_at, status, evidence_reinforce, evidence_negate, protected_, valid_until, frozen_at, embedding)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              null,
              null,
              null,
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
      appendMissingMessages(characterId, items)
      setMeta(`chat_mtime:${safeName}`, mtime)
      logger.info('memory', `已同步会话历史到记忆库: ${characterId}（${items.length} 条）`)
    }
  } catch (err) {
    logger.warn('memory', `会话历史同步失败（原文件未动）: ${(err as Error).message}`)
  }
}
