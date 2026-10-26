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

function factInput(over: Record<string, unknown>) {
  return {
    text: '',
    entity: 'user' as const,
    subject: '用户',
    importance: 8,
    confidence: 1,
    reason: '明确陈述',
    ...over,
  }
}

describe('memory history and correction', () => {
  it('改城市：新值生效，旧值不再默认注入，问过去才出现', async () => {
    await applyCandidates('h1', {
      facts: [factInput({ text: '用户住在北京', attribute: '居住城市', object: '北京' })],
      stories: [],
    })
    const result = await applyCandidates('h1', {
      facts: [factInput({ text: '用户住在上海', attribute: '居住城市', object: '上海' })],
      stories: [],
    })
    expect(result.insertedFacts).toBe(1)

    const facts = await loadFacts('h1')
    expect(facts).toHaveLength(2)
    expect(facts.every((f) => f.status === 'active')).toBe(true)

    expect(buildMemoryBlock(facts, [], 900, '今天吃什么') ?? '').not.toContain('北京')
    expect(buildMemoryBlock(facts, [], 900, '今天吃什么') ?? '').toContain('上海')
    expect(buildMemoryBlock(facts, [], 900, '你还记得我以前住哪吗') ?? '').toContain('北京')
  })

  it('同一句话又说一遍只确认，不再新增', async () => {
    const payload = {
      facts: [factInput({ text: '用户喜欢咖啡', attribute: '喜欢的饮料', object: '咖啡' })],
      stories: [],
    }
    await applyCandidates('h2', payload)
    const again = await applyCandidates('h2', payload)
    expect(again.insertedFacts).toBe(0)
    expect(again.refreshedFacts).toBe(1)
    expect(await loadFacts('h2')).toHaveLength(1)
  })

  it('多值谓词：两种喜好可以并存', async () => {
    await applyCandidates('h3', {
      facts: [factInput({ text: '用户喜欢咖啡', attribute: '喜欢的饮料', object: '咖啡', importance: 6 })],
      stories: [],
    })
    await applyCandidates('h3', {
      facts: [factInput({ text: '用户喜欢茶', attribute: '喜欢的饮料', object: '茶', importance: 6 })],
      stories: [],
    })
    const facts = await loadFacts('h3')
    const block = buildMemoryBlock(facts, [], 900, '你记得我喜欢喝什么吗') ?? ''
    expect(block).toContain('咖啡')
    expect(block).toContain('茶')
  })

  it('否定之后只留下否定，历史里能查到原来喜欢的', async () => {
    await applyCandidates('h4', {
      facts: [factInput({ text: '用户喜欢咖啡', attribute: '喜欢的饮料', object: '咖啡' })],
      stories: [],
    })
    await applyCandidates('h4', {
      facts: [factInput({ text: '用户不喜欢咖啡了', attribute: '喜欢的饮料', object: '咖啡', polarity: false })],
      stories: [],
    })
    const facts = await loadFacts('h4')
    expect(buildMemoryBlock(facts, [], 900, '我喜欢喝什么') ?? '').not.toContain('喜欢咖啡')
    expect(buildMemoryBlock(facts, [], 900, '我以前喜欢喝什么') ?? '').toContain('喜欢咖啡')
  })

  it('用户钉住的记忆不会被后来的说法覆盖', async () => {
    await applyCandidates('h5', {
      facts: [factInput({ text: '用户的生日是3月15日', attribute: '生日', object: '3月15日', frozen: true, importance: 10 })],
      stories: [],
    })
    await applyCandidates('h5', {
      facts: [factInput({ text: '用户的生日是3月16日', attribute: '生日', object: '3月16日', importance: 10 })],
      stories: [],
    })
    const facts = await loadFacts('h5')
    const block = buildMemoryBlock(facts, [], 900, '我的生日是哪天') ?? ''
    expect(block).toContain('3月15日')
    expect(block).not.toContain('3月16日')
  })
})
