import fs from 'node:fs'
import path from 'node:path'
import { backupRootDir, db, logger, rows, setMeta, withTx } from './core'
import { sqliteSnapshot } from './backup'
import { indexMessage } from './search'
import { factRowToMemory, insertMemoryRowRaw, storyRowToMemory } from './memoryRows'
import type { FactRow, StoryRow } from './types'

export const SCHEMA = `
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

function ensureColumns(table: string, columns: Array<[string, string]>): void {
  const existing = rows(`PRAGMA table_info(${table})`, []).map((r) => String(r.name))
  for (const [name, ddl] of columns) {
    if (!existing.includes(name)) {
      db!.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`)
      logger.info('memory', `${table} 表新增列: ${name}`)
    }
  }
}

export function migrateMessagesSchema(): void {
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

export function migrateFactsSchema(): void {
  try {
    const hasFacts = rows("SELECT name FROM sqlite_master WHERE type='table' AND name='facts'", []).length > 0
    const hasStories = rows("SELECT name FROM sqlite_master WHERE type='table' AND name='stories'", []).length > 0
    if (!hasFacts && !hasStories) return
    const factColumns = hasFacts ? rows('PRAGMA table_info(facts)', []).map((r) => String(r.name)) : []
    const storyColumns = hasStories ? rows('PRAGMA table_info(stories)', []).map((r) => String(r.name)) : []
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
    const missing = hasFacts ? additions.filter(([name]) => !factColumns.includes(name)) : []
    const needStoryEvidence = hasStories && !storyColumns.includes('source_evidence')
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
