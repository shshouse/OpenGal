import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from '../../src/main/services/memoryDb'
import * as store from '../../src/main/services/memoryStore'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-e2e-'))

function say(role: 'user' | 'assistant', text: string, ts: number) {
  db.appendMessage({
    character_id: 'c1',
    role,
    content: JSON.stringify({ role, content: text }),
    ts,
    archived: 0,
  })
}

describe('记忆端到端', () => {
  beforeAll(async () => {
    await db.initMemoryDb(root)
    await db.memoryDbReady()
  })

  afterAll(() => {
    db.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('原文入库、提取事实、召回原话、归档，整条链路可用', async () => {
    const base = Date.UTC(2026, 9, 1, 10, 0)
    say('user', '我养了一只橘猫，名字叫年糕', base)
    say('assistant', '年糕这个名字很可爱', base + 60_000)
    say('user', '下个月我要去南京出差', base + 120_000)

    const applied = await store.applyCandidates('c1', {
      facts: [
        {
          text: '用户养了一只叫年糕的橘猫',
          entity: 'user',
          importance: 8,
          confidence: 1,
          reason: '用户明说',
        },
      ],
      stories: [],
      evidence: { fromTs: base, toTs: base + 120_000 },
    })
    expect(applied.insertedFacts).toBe(1)

    const facts = await store.loadFacts('c1')
    expect(facts).toHaveLength(1)
    expect(facts[0].text).toContain('年糕')
    expect(facts[0].created_at).toBeTruthy()

    const block = await store.getMemoryBlock('c1')
    expect(block).toContain('年糕')

    const verbatim = await store.recallVerbatim('c1', '橘猫')
    expect(verbatim).toContain('我养了一只橘猫')
    expect(verbatim).toContain('2026-10-01')

    const pruned = await store.pruneOverflow('c1', 0)
    expect(pruned.archived).toBe(1)
    expect(db.listMemoryRows('c1')).toHaveLength(0)
    expect(db.listMemoryRows('c1', { includeInactive: true })).toHaveLength(1)
  })

  it('重建只清派生数据，原文仍在', async () => {
    expect(await store.rebuildMemory('c1', 'rebuild:c1')).toEqual({ facts: 1, stories: 0 })
    const verbatim = await store.recallVerbatim('c1', '橘猫')
    expect(verbatim).toContain('我养了一只橘猫')
  })
})
