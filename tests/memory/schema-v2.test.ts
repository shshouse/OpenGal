import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from '../../src/main/services/memoryDb'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-schema-v2-'))

describe('schema v2 迁移', () => {
  beforeAll(async () => {
    await db.initMemoryDb(root)
    await db.memoryDbReady()
  })

  afterAll(() => {
    db.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('把旧 evidence 里的印证次数和消息 id 搬到新位置', () => {
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
      id: 'legacy',
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
      embedding: null,
      evidence: JSON.stringify({ fromTs: 900, toTs: 2100, messageIds, reinforce: 3 }),
    })

    // 模拟迁移前的库：版本停在 1，印证次数只在 JSON 里
    db.setMeta('schema_version', '1')
    db.migrateMemoryV2()

    const row = db.listMemoryRows('c-v2').find((item) => item.id === 'legacy')
    expect(row?.reinforce).toBe(3)
    expect(db.getMeta('schema_version')).toBe('2')
    expect(db.memoryEvidence('c-v2', 'legacy').map((item) => item.id).sort()).toEqual([...messageIds].sort())
  })

  it('重复执行不会重复插入来源', () => {
    db.migrateMemoryV2()
    expect(db.memoryEvidence('c-v2', 'legacy')).toHaveLength(2)
  })
})
