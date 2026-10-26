import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyCandidates,
  buildMemoryBlock,
  initMemoryStore,
  loadFacts,
} from '../../src/main/services/memoryStore'
import { closeMemoryDb, memoryDbReady } from '../../src/main/services/memoryDb'

const root = path.join(os.tmpdir(), `og-memory-history-${Date.now()}`)
initMemoryStore(root)
await memoryDbReady()

afterAll(() => {
  closeMemoryDb()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('memory history and correction', () => {
  it('改城市：旧值标记失效并记录被谁替代，只有问过去才召回', async () => {
    await applyCandidates('h1', {
      facts: [{
        text: '用户住在北京',
        entity: 'user',
        subject: '用户',
        attribute: '居住城市',
        attributed_to: 'user',
        importance: 8,
        confidence: 1,
        reason: '明确陈述',
      }],
      stories: [],
    })

    const result = await applyCandidates(
      'h1',
      {
        facts: [{
          text: '用户住在上海',
          entity: 'user',
          subject: '用户',
          attribute: '居住城市',
          attributed_to: 'user',
          importance: 8,
          confidence: 1,
          reason: '明确陈述',
        }],
        stories: [],
      },
      async () => [{ index: 0, verdict: 'contradicts' }],
    )

    expect(result.supersededFacts).toBe(1)
    const facts = await loadFacts('h1')
    const old = facts.find((f) => f.text === '用户住在北京')!
    const fresh = facts.find((f) => f.text === '用户住在上海')!
    expect(old.status).toBe('superseded')
    expect(old.invalid_at).toBeTruthy()
    expect(old.superseded_by).toBe(fresh.id)
    expect(fresh.status).toBe('active')

    expect(buildMemoryBlock(facts, [], 900, '今天吃什么') ?? '').not.toContain('北京')
    expect(buildMemoryBlock(facts, [], 900, '你还记得我以前住哪吗') ?? '').toContain('北京')
  })

  it('裁判不可用时按新信息写入，绝不强化旧记忆', async () => {
    await applyCandidates('h2', {
      facts: [{
        text: '用户喜欢咖啡',
        entity: 'user',
        subject: '用户',
        attribute: '喜欢的饮料',
        attributed_to: 'user',
        importance: 6,
        confidence: 1,
        reason: '明确陈述',
      }],
      stories: [],
    })

    const result = await applyCandidates('h2', {
      facts: [{
        text: '用户喜欢咖啡',
        entity: 'user',
        subject: '用户',
        attribute: '喜欢的饮料',
        attributed_to: 'user',
        importance: 6,
        confidence: 1,
        reason: '明确陈述',
      }],
      stories: [],
    })

    expect(result.refreshedFacts).toBe(0)
    expect(result.insertedFacts).toBe(1)
  })

  it('同槽位并存多条时，只把分数最高的一条注入提示词', async () => {
    await applyCandidates('h3', {
      facts: [{
        text: '用户住在北京',
        entity: 'user',
        subject: '用户',
        attribute: '居住城市',
        attributed_to: 'user',
        importance: 4,
        confidence: 1,
        reason: '明确陈述',
      }],
      stories: [],
    })
    await applyCandidates('h3', {
      facts: [{
        text: '用户住在上海',
        entity: 'user',
        subject: '用户',
        attribute: '居住城市',
        attributed_to: 'user',
        importance: 9,
        confidence: 1,
        reason: '明确陈述',
      }],
      stories: [],
    })

    const facts = await loadFacts('h3')
    expect(facts.filter((f) => f.status === 'active' && f.attribute === '居住城市')).toHaveLength(2)

    const block = buildMemoryBlock(facts, [], 900, '你现在住哪') ?? ''
    expect(block).toContain('上海')
    expect(block).not.toContain('北京')
  })
})
