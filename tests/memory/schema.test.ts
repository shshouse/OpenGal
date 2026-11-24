import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as db from '../../src/main/services/memory/db'
import { setReadyPromise } from '../../src/main/services/memory/db/core'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-schema-gate-'))

describe('单角色记忆库版本闸门与来源证据', () => {
  beforeAll(async () => {
    await db.initMemoryDb(root)
    await db.memoryDbReady()
  })

  afterAll(() => {
    db.closeMemoryDb()
    setReadyPromise(null)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('关联记忆与原话消息 ID，支持按证据精确回溯', () => {
    db.appendMessage({
      role_id: 'c-v2',
      role: 'user',
      content: JSON.stringify({ role: 'user', content: '我养了一只猫' }),
      ts: 1000,
      archived: 0,
    })
    db.appendMessage({
      role_id: 'c-v2',
      role: 'user',
      content: JSON.stringify({ role: 'user', content: '它叫年糕' }),
      ts: 2000,
      archived: 0,
    })
    const messageIds = db.listUnarchivedMessages('c-v2').map((row) => row.id as number)

    db.insertMemoryRow('c-v2', {
      id: 'mem-cat',
      role_id: 'c-v2',
      kind: 'fact',
      text: '用户养了一只叫年糕的猫',
      state: 'active',
      importance: 8,
      happened_at: null,
      created_at: 1000,
      source_from: 900,
      source_to: 2100,
      supersedes: null,
      pinned: 0,
      reinforce: 3,
      embedding: null,
      evidence: JSON.stringify({ fromTs: 900, toTs: 2100, messageIds, reinforce: 3 }),
    })

    const row = db.listMemoryRows('c-v2').find((item) => item.id === 'mem-cat')
    expect(row?.reinforce).toBe(3)
    expect(db.getRoleMeta('c-v2', 'schema_version')).toBe(String(db.ROLE_DB_SCHEMA_VERSION))
    expect(db.memoryEvidence('c-v2', 'mem-cat').map((item) => item.id).sort()).toEqual([...messageIds].sort())
  })

  it('高版本角色文件夹放入旧版软件时拒绝读写挂载以保护数据', () => {
    const futureDir = path.join(root, 'roles', 'future-role')
    fs.mkdirSync(futureDir, { recursive: true })
    const raw = new DatabaseSync(path.join(futureDir, 'memory.db'))
    raw.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version', '999');")
    raw.close()

    expect(() => db.openRoleDb('future-role')).toThrow(db.RoleDbVersionError)
  })
})
