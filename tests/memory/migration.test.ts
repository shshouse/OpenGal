import { afterAll, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  appendLifeLog,
  closeMemoryDb,
  getRoleState,
  initMemoryDb,
  insertFactRow,
  listFacts,
  listLifeLogs,
  memoryDbReady,
  patchRoleState,
  sleepRoleDb,
} from '../../src/main/services/memory/db'
import { setReadyPromise } from '../../src/main/services/memory/db/core'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-migrate-'))

it('保留旧版全局 memory.db 原文件并备份，同时单角色目录可独立迁移与改名复用', async () => {
  const legacyFile = path.join(root, 'memory.db')
  const legacy = new DatabaseSync(legacyFile)
  legacy.exec('CREATE TABLE legacy_marker (id INTEGER PRIMARY KEY); INSERT INTO legacy_marker VALUES (1);')
  legacy.close()

  await initMemoryDb(root)
  await memoryDbReady()

  expect(fs.existsSync(legacyFile)).toBe(true)
  expect(fs.existsSync(path.join(root, 'backups', 'legacy-global-memory.db'))).toBe(true)

  insertFactRow('role-origin', {
    id: 'f-portable',
    role_id: 'role-origin',
    text: '用户喜欢喝手冲咖啡',
    entity: 'user',
    subject: null,
    attribute: null,
    importance: 8,
    confidence: 0.9,
    source: 'user_statement',
    created_at: '2026-11-18T00:00:00.000Z',
    last_confirmed_at: '2026-11-18T00:00:00.000Z',
    status: 'active',
    evidence_reinforce: 0,
    evidence_negate: 0,
    protected_: 0,
    valid_until: null,
    frozen_at: null,
    embedding: null,
    source_evidence: '{"fromTs":1,"toTs":2}',
  })
  patchRoleState('role-origin', {
    mood: 'happy',
    energy: 92,
    relationshipStage: '熟稔搭档',
    currentActivity: '翻阅医学笔记',
  })
  appendLifeLog('role-origin', {
    kind: 'diary',
    title: '今日随笔',
    content: '博士今天按时休息了。',
    mood: 'relaxed',
  })

  sleepRoleDb('role-origin')
  const originDir = path.join(root, 'roles', 'role-origin')
  expect(fs.existsSync(path.join(originDir, 'memory.db-wal'))).toBe(false)

  const copiedDir = path.join(root, 'roles', 'role-parallel')
  fs.cpSync(originDir, copiedDir, { recursive: true })

  const copiedFacts = listFacts('role-parallel')
  expect(copiedFacts).toHaveLength(1)
  expect(copiedFacts[0]?.text).toBe('用户喜欢喝手冲咖啡')
  expect(copiedFacts[0]?.source_evidence).toBe('{"fromTs":1,"toTs":2}')
  expect(getRoleState('role-parallel').relationshipStage).toBe('熟稔搭档')
  expect(listLifeLogs('role-parallel')).toHaveLength(1)
})

afterAll(() => {
  closeMemoryDb()
  setReadyPromise(null)
  fs.rmSync(root, { recursive: true, force: true })
})
