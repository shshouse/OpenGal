import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from '../../src/main/services/memoryDb'
import { applyCandidates, getMemoryBlock } from '../../src/main/services/memory'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-reinforce-'))

async function reinforceOf(roleId: string, id: string): Promise<number> {
  return db.listMemoryRows(roleId, { includeInactive: true }).find((row) => row.id === id)?.reinforce ?? 0
}

describe('召回时强化', () => {
  beforeAll(async () => {
    await db.initMemoryDb(root)
    await db.memoryDbReady()
    await applyCandidates('c1', {
      facts: [{
        text: '用户养了一只叫年糕的橘猫',
        entity: 'user',
        subject: '用户',
        attribute: '猫的名字',
        object: '年糕',
        attributed_to: 'user',
        importance: 8,
        confidence: 1,
        reason: '明确陈述',
      }],
      stories: [],
    })
  })

  afterAll(() => {
    db.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('进了上下文就记一次印证', async () => {
    const id = db.listMemoryRows('c1', { includeInactive: true })[0].id
    const block = await getMemoryBlock('c1', '我养了什么猫')
    expect(block).toContain('年糕')
    expect(await reinforceOf('c1', id)).toBe(1)
  })

  it('没有上下文的读取（快照、界面）不算想起', async () => {
    const id = db.listMemoryRows('c1', { includeInactive: true })[0].id
    const before = await reinforceOf('c1', id)
    await getMemoryBlock('c1')
    expect(await reinforceOf('c1', id)).toBe(before)
  })
})
