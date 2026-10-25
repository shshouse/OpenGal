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
