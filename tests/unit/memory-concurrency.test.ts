import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CorpusBuffer } from '@/features/memory/corpusBuffer'
import {
  applyCandidates,
  deleteFact,
  initMemoryStore,
  loadFacts,
  manualAddFact,
} from '../../src/main/services/memoryStore'
import { closeMemoryDb, memoryDbReady } from '../../src/main/services/memoryDb'

let root = ''

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengal-vitest-memory-'))
  initMemoryStore(root, {
    injectCharCap: 8000,
    batchTurns: 8,
    idleMinutes: 5,
    fallbackHours: 12,
  })
  await memoryDbReady()
})

afterAll(() => {
  closeMemoryDb()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('CorpusBuffer', () => {
  it('提取期间新进入的语料不被清理', () => {
    const buffer = new CorpusBuffer(1000)
    buffer.push({ characterId: 'c1', role: 'user', text: 'A', at: 1 })
    const snapshot = buffer.snapshot()
    buffer.push({ characterId: 'c1', role: 'user', text: 'B', at: 2 })
    buffer.dropExtracted('c1', snapshot.maxSeq)
    const left = buffer.entries()
    expect(left).toHaveLength(1)
    expect(left[0].text).toBe('B')
  })
})

describe('memoryStore 并发写', () => {
  it('并发手动添加不丢失', async () => {
    await Promise.all([manualAddFact('c2', '并发添加 A'), manualAddFact('c2', '并发添加 B')])
    expect(await loadFacts('c2')).toHaveLength(2)
  })

  it('删除后相似信息不会复活旧记忆', async () => {
    const F1 = '用户每天跑步五公里'
    const F2 = '用户每周游泳三公里'

    const fact = await manualAddFact('c3', F1)
    await deleteFact('c3', fact.id)
    await applyCandidates('c3', {
      facts: [{ text: F2, entity: 'user', importance: 6, confidence: 0.5, reason: 'test' }],
      stories: [],
    })

    const facts = await loadFacts('c3')
    expect(facts.some((item) => item.id === fact.id)).toBe(false)
    expect(facts.some((item) => item.text === F2)).toBe(true)
  })
})
