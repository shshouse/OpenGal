import { afterAll, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  closeMemoryDb,
  initMemoryDb,
  insertFactRow,
  listFacts,
  memoryDbReady,
} from '../../src/main/services/memoryDb'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-migrate-'))

it('旧库升级时补充 source_evidence 列且保留原有数据', async () => {
  const legacy = new DatabaseSync(path.join(root, 'memory.db'))
  legacy.exec(`
    CREATE TABLE facts (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL, text TEXT NOT NULL, entity TEXT NOT NULL,
      importance INTEGER NOT NULL, confidence REAL NOT NULL, source TEXT NOT NULL,
      created_at TEXT NOT NULL, last_confirmed_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      evidence_reinforce INTEGER NOT NULL DEFAULT 0, evidence_negate INTEGER NOT NULL DEFAULT 0,
      protected_ INTEGER NOT NULL DEFAULT 0, valid_until TEXT, frozen_at TEXT, embedding TEXT
    );
    CREATE TABLE stories (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
      occurred_at TEXT NOT NULL, due_at TEXT, fulfilled INTEGER NOT NULL DEFAULT 0,
      importance INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    );
    INSERT INTO facts(id, character_id, text, entity, importance, confidence, source, created_at, last_confirmed_at)
    VALUES ('f-legacy', 'c-legacy', '旧记忆', 'user', 5, 0.8, 'user_statement', '2026-01-01', '2026-01-01');
  `)
  legacy.close()

  await initMemoryDb(root)
  await memoryDbReady()

  const facts = listFacts('c-legacy')
  expect(facts).toHaveLength(1)
  expect(facts[0].text).toBe('旧记忆')
  expect(facts[0].source_evidence).toBeNull()

  insertFactRow('c-legacy', { ...facts[0], id: 'f-new', source_evidence: '{"fromTs":1,"toTs":2}' })
  const after = listFacts('c-legacy').find((row) => row.id === 'f-new')
  expect(after?.source_evidence).toBe('{"fromTs":1,"toTs":2}')
})

afterAll(() => {
  closeMemoryDb()
  fs.rmSync(root, { recursive: true, force: true })
})
