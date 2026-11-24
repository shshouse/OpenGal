/**
 * 角色记忆库的结构版本。正式发布前没有 v1 基线，当前结构就是第 1 版；
 * 以后改结构再逐次 +1，不要提前占号。
 */
export const ROLE_DB_SCHEMA_VERSION = 1

export class RoleDbVersionError extends Error {
  readonly dbVersion: number
  readonly supportedVersion: number

  constructor(dbVersion: number, supportedVersion = ROLE_DB_SCHEMA_VERSION) {
    super(
      `角色记忆库版本(${dbVersion})高于当前 OpenGal 支持的版本(${supportedVersion})，为避免损坏数据已拒绝挂载，请升级 OpenGal。`,
    )
    this.name = 'RoleDbVersionError'
    this.dbVersion = dbVersion
    this.supportedVersion = supportedVersion
  }
}

export const ROLE_DB_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mood TEXT NOT NULL DEFAULT 'neutral',
  energy INTEGER NOT NULL DEFAULT 85,
  relationship_stage TEXT NOT NULL DEFAULT '初识',
  current_activity TEXT NOT NULL DEFAULT '待机中',
  short_term_goal TEXT NOT NULL DEFAULT '',
  next_tick_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS life_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  mood TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_life_log_ts ON life_log(ts DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_life_log_kind ON life_log(kind, ts DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'chat',
  client_id TEXT,
  translation TEXT,
  translation_lang TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_archived_ts ON messages(archived, ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id ON messages(client_id) WHERE client_id IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  message_id UNINDEXED,
  tokens
);
CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.id;
END;

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  text TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
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
  reinforce INTEGER NOT NULL DEFAULT 0,
  embedding TEXT,
  valid_from TEXT,
  invalid_at TEXT,
  due_at TEXT,
  frozen_at TEXT,
  evidence TEXT
);
CREATE INDEX IF NOT EXISTS idx_mem_state_kind ON memories(state, kind);
CREATE INDEX IF NOT EXISTS idx_mem_created ON memories(created_at);

CREATE TABLE IF NOT EXISTS memory_sources (
  memory_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  PRIMARY KEY (memory_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_memory_sources_msg ON memory_sources(message_id);

CREATE TABLE IF NOT EXISTS memory_changelog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  reason TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changelog_memory ON memory_changelog(memory_id, seq);
CREATE INDEX IF NOT EXISTS idx_changelog_ts ON memory_changelog(ts DESC);
`
