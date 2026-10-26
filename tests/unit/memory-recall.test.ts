import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as memoryDb from '../../src/main/services/memoryDb'
import * as memoryStore from '../../src/main/services/memoryStore'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-recall-'))

const { recallVerbatim } = memoryStore as unknown as {
  recallVerbatim?: (characterId: string, query: string) => Promise<string | null>
}
const { appendMissingMessages } = memoryDb as unknown as {
  appendMissingMessages?: (
    characterId: string,
    items: Array<Omit<memoryDb.MessageRow, 'id'>>,
  ) => number
}

function seedOldConversation(characterId: string) {
  const base = Date.UTC(2024, 2, 12, 6, 20)
  const lines: Array<[string, string]> = [
    ['user', '今天天气不错'],
    ['user', '我想养一只猫'],
    ['assistant', '真的吗？你想养什么品种？'],
    ['user', '想养橘猫，名字就叫年糕'],
  ]
  lines.forEach(([role, text], index) => {
    memoryDb.appendMessage({
      character_id: characterId,
      role,
      content: JSON.stringify({ role, content: text }),
      ts: base + index * 60_000,
      archived: 1,
    })
  })
}

describe('原话检索', () => {
  beforeAll(async () => {
    await memoryDb.initMemoryDb(root)
    await memoryDb.memoryDbReady()
    seedOldConversation('c-old')
    seedOldConversation('c-other')
  })

  afterAll(() => {
    memoryDb.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('已归档的原话仍能按关键词找回，并带上相邻对话', async () => {
    expect(recallVerbatim).toBeTypeOf('function')
    const text = await recallVerbatim!('c-old', '猫')
    expect(text).toContain('我想养一只猫')
    expect(text).toContain('真的吗？你想养什么品种？')
    expect(text).toContain('2024-03-12')
  })

  it('不会把别的角色的原话检索进来', async () => {
    const text = await recallVerbatim!('c-old', '年糕')
    expect(text).toContain('年糕')
    const other = await recallVerbatim!('c-missing', '年糕')
    expect(other).toBeNull()
  })
  it('按时间范围检索原话，范围外不返回', () => {
    const searchRange = (memoryDb as unknown as {
      searchMessagesInRange?: (
        characterId: string,
        query: string,
        fromTs: number,
        toTs: number,
      ) => memoryDb.MessageRow[]
    }).searchMessagesInRange
    expect(searchRange).toBeTypeOf('function')

    const from = Date.UTC(2024, 2, 12, 6, 19)
    const to = Date.UTC(2024, 2, 12, 6, 22)
    const hits = searchRange!('c-old', '猫', from, to)
    expect(hits.some((row) => row.content.includes('一只猫'))).toBe(true)
    expect(searchRange!('c-old', '猫', from - 10 * 60_000, to - 10 * 60_000)).toHaveLength(0)
  })

  it('写入记忆时记录来源时间范围，并能回查原话', async () => {
    const applyCandidates = (memoryStore as unknown as {
      applyCandidates?: (
        characterId: string,
        payload: unknown,
      ) => Promise<unknown>
    }).applyCandidates
    const messagesInRange = (memoryDb as unknown as {
      messagesInRange?: (characterId: string, fromTs: number, toTs: number) => memoryDb.MessageRow[]
    }).messagesInRange
    expect(applyCandidates).toBeTypeOf('function')
    expect(messagesInRange).toBeTypeOf('function')

    memoryDb.appendMessage({
      character_id: 'c-ev',
      role: 'user',
      content: JSON.stringify({ role: 'user', content: '我下周要去南京出差' }),
      ts: 1000,
      archived: 1,
    })
    memoryDb.appendMessage({
      character_id: 'c-ev',
      role: 'assistant',
      content: JSON.stringify({ role: 'assistant', content: '南京这时候很热吧' }),
      ts: 2000,
      archived: 1,
    })
    await applyCandidates!('c-ev', {
      facts: [
        { text: '用户下周去南京出差', entity: 'user', importance: 8, confidence: 1, reason: '用户明说' },
      ],
      stories: [],
      evidence: { fromTs: 900, toTs: 2100 },
    })

    const fact = memoryDb.listFacts('c-ev')[0] as unknown as { source_evidence?: string | null }
    expect(fact.source_evidence).toBeTruthy()
    const evidence = JSON.parse(fact.source_evidence!) as {
      fromTs: number
      toTs: number
      messageIds: number[]
    }
    expect(evidence.fromTs).toBe(900)
    expect(evidence.toTs).toBe(2100)
    expect(evidence.messageIds.length).toBeGreaterThan(0)

    const rows = messagesInRange!('c-ev', 900, 2100)
    expect(rows).toHaveLength(2)
    expect(rows[0].content).toContain('南京')
  })

  it('只追加缺失消息，不删除已有消息，也不重复插入', () => {
    expect(appendMissingMessages).toBeTypeOf('function')
    const items = [
      { character_id: 'c-import', role: 'user', content: '第一句', ts: 100, archived: 0 },
      { character_id: 'c-import', role: 'assistant', content: '第二句', ts: 200, archived: 0 },
    ]
    expect(appendMissingMessages!('c-import', items)).toBe(2)
    expect(appendMissingMessages!('c-import', items)).toBe(0)

    const rows = memoryDb.listUnarchivedMessages('c-import')
    expect(rows.map((r) => r.content)).toEqual(['第一句', '第二句'])

    appendMissingMessages!('c-import', [
      { character_id: 'c-import', role: 'user', content: '第三句', ts: 300, archived: 0 },
    ])
    expect(memoryDb.listUnarchivedMessages('c-import')).toHaveLength(3)
  })
})
