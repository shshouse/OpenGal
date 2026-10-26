import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  advanceCursor,
  applyCandidates,
  initMemoryStore,
  loadFacts,
  loadStories,
  pendingFromArchive,
  rebuildMemory,
} from '../../src/main/services/memoryStore'
import {
  addSummary,
  appendMessage,
  bootstrapCursor,
  closeMemoryDb,
  listFacts,
  listSummaries,
  listUnarchivedMessages,
  memoryDbReady,
} from '../../src/main/services/memoryDb'

const root = path.join(os.tmpdir(), `og-memory-cursor-${Date.now()}`)
initMemoryStore(root)
await memoryDbReady()

afterAll(() => {
  closeMemoryDb()
  fs.rmSync(root, { recursive: true, force: true })
})

function seedMessages(characterId: string, base: number, lines: string[]) {
  lines.forEach((text, index) => {
    appendMessage({
      character_id: characterId,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: JSON.stringify({ role: index % 2 === 0 ? 'user' : 'assistant', content: text }),
      ts: base + index * 1000,
      archived: 0,
    })
  })
}

describe('提取游标与来源', () => {
  it('游标只增不减，重启后仍能读到', async () => {
    await advanceCursor('k1', 1000)
    await advanceCursor('k1', 900)
    const pending = await pendingFromArchive('k1')
    expect(pending.cursor).toBe(1000)
  })

  it('首次引导只回溯最近 N 条，不重放整段历史', () => {
    seedMessages('k5', 100, ['一', '二', '三', '四', '五'])
    expect(bootstrapCursor('k5', 2)).toBe(2100)
    expect(bootstrapCursor('k5', 200)).toBe(0)
  })

  it('补记只返回游标之后的原文，并截断', async () => {
    seedMessages('k2', 5000, ['第一句', '第二句', '第三句'])
    await advanceCursor('k2', 5000)
    const pending = await pendingFromArchive('k2', 10)
    expect(pending.entries.map((e) => e.text)).toEqual(['第二句', '第三句'])
    expect(pending.entries[0].role).toBe('assistant')
  })

  it('写入记忆时记录来源消息 id', async () => {
    seedMessages('k3', 9000, ['我养了一只猫，叫年糕'])
    const rows = listUnarchivedMessages('k3')
    const messageId = rows[0].id as number

    await applyCandidates('k3', {
      facts: [{
        text: '用户养了一只猫，叫年糕',
        entity: 'user',
        subject: '用户',
        attribute: '猫的名字',
        attributed_to: 'user',
        importance: 8,
        confidence: 1,
        reason: '明确陈述',
      }],
      stories: [],
      evidence: { fromTs: rows[0].ts, toTs: rows[0].ts },
    })

    const stored = listFacts('k3')[0]
    const evidence = JSON.parse(stored.source_evidence ?? '{}') as { messageIds?: number[] }
    expect(evidence.messageIds).toContain(messageId)
  })

  it('重建必须显式确认，只清派生数据，不动原文', async () => {
    seedMessages('k4', 12000, ['用户住在北京'])
    const messageCount = listUnarchivedMessages('k4').length

    await applyCandidates('k4', {
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
      stories: [{ kind: 'milestone', text: '第一次一起看电影', importance: 6, reason: '共同经历' }],
    })
    addSummary('k4', { start_ts: 1, end_ts: 2, text: '摘要', message_count: 1 })
    await advanceCursor('k4', 99999)

    await expect(rebuildMemory('k4', 'yes')).rejects.toThrow()
    expect((await loadFacts('k4')).length).toBe(1)

    const removed = await rebuildMemory('k4', 'rebuild:k4')
    expect(removed).toEqual({ facts: 1, stories: 1 })
    expect(await loadFacts('k4')).toHaveLength(0)
    expect(await loadStories('k4')).toHaveLength(0)
    expect(listSummaries('k4')).toHaveLength(1)

    expect(listUnarchivedMessages('k4')).toHaveLength(messageCount)
    expect((await pendingFromArchive('k4')).cursor).toBe(0)
  })
})
