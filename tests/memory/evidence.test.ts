import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from '../../src/main/services/memoryDb'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-evidence-'))

const api = db as unknown as {
  memoryEvidence?: (characterId: string, memoryId: string) => Array<{ id: number; content: string; ts: number }>
}

function say(characterId: string, text: string, ts: number) {
  db.appendMessage({
    character_id: characterId,
    role: 'user',
    content: JSON.stringify({ role: 'user', content: text }),
    ts,
    archived: 1,
  })
}

function memory(id: string, extra: Record<string, unknown> = {}) {
  db.insertMemoryRow('c1', {
    id,
    character_id: 'c1',
    kind: 'fact',
    text: '用户养了一只橘猫',
    state: 'active',
    importance: 5,
    happened_at: null,
    created_at: 1000,
    source_from: null,
    source_to: null,
    supersedes: null,
    pinned: 0,
    embedding: null,
    ...extra,
  } as never)
}

describe('记忆来源', () => {
  beforeAll(async () => {
    await db.initMemoryDb(root)
    await db.memoryDbReady()
    say('c1', '我养了一只橘猫，名字叫年糕', 1000)
    say('c1', '它昨天打翻了水杯', 2000)
    say('c1', '别的角色说的话', 3000)
  })

  afterAll(() => {
    db.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('按时间范围返回来源原话', () => {
    expect(api.memoryEvidence).toBeTypeOf('function')
    memory('m-range', { source_from: 900, source_to: 2100 })
    const rows = api.memoryEvidence!('c1', 'm-range')
    expect(rows).toHaveLength(2)
    expect(rows[0].content).toContain('橘猫')
    expect(rows[1].content).toContain('水杯')
  })

  it('优先使用显式 messageIds', () => {
    memory('m-ids', { evidence: JSON.stringify({ fromTs: 0, toTs: 5000, messageIds: [1] }) })
    const rows = api.memoryEvidence!('c1', 'm-ids')
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toContain('橘猫')
  })

  it('没有来源时返回空数组', () => {
    memory('m-none')
    expect(api.memoryEvidence!('c1', 'm-none')).toEqual([])
  })
})
