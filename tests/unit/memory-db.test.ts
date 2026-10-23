import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  addSummary,
  appendMessage,
  archiveMessagesRange,
  clearCharacterMemory,
  clearCharacterMessages,
  closeMemoryDb,
  commitCompression,
  deleteFactRow,
  getFactRow,
  getMeta,
  initMemoryDb,
  insertFactRow,
  insertStoryRow,
  latestMessageId,
  listFacts,
  listStories,
  listSummaries,
  listUnarchivedMessages,
  memoryDbReady,
  negateFactRow,
  reinforceFactRow,
  replaceUnarchivedMessages,
  saveChatMessages,
  saveFacts,
  saveStories,
  setFactEmbeddingRow,
  setFactFrozenRow,
  setFactStatusRow,
  setMeta,
  setStoryStatusRow,
  type FactRow,
  type StoryRow,
} from '../../src/main/services/memoryDb'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memorydb-'))

function fact(id: string, overrides: Partial<FactRow> = {}): FactRow {
  return {
    id,
    character_id: 'c-fact',
    text: `事实 ${id}`,
    entity: 'user',
    importance: 5,
    confidence: 0.8,
    source: 'user_statement',
    created_at: '2026-01-01T00:00:00.000Z',
    last_confirmed_at: '2026-01-01T00:00:00.000Z',
    status: 'active',
    evidence_reinforce: 0,
    evidence_negate: 0,
    protected_: 0,
    valid_until: null,
    frozen_at: null,
    embedding: null,
    ...overrides,
  }
}

function story(id: string, overrides: Partial<StoryRow> = {}): StoryRow {
  return {
    id,
    character_id: 'c-story',
    kind: 'event',
    text: `故事 ${id}`,
    occurred_at: '2026-01-01T00:00:00.000Z',
    due_at: null,
    fulfilled: 0,
    importance: 5,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('memoryDb', () => {
  beforeAll(async () => {
    await initMemoryDb(root)
    await memoryDbReady()
  })

  afterAll(() => {
    closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('meta 读写覆盖旧值', () => {
    expect(getMeta('missing')).toBeNull()
    setMeta('k', 'v1')
    expect(getMeta('k')).toBe('v1')
    setMeta('k', 'v2')
    expect(getMeta('k')).toBe('v2')
  })

  it('消息追加、归档与清理', () => {
    appendMessage({ character_id: 'c-msg', role: 'user', content: '一', ts: 1, archived: 0 })
    appendMessage({ character_id: 'c-msg', role: 'assistant', content: '二', ts: 2, archived: 0 })
    appendMessage({ character_id: 'c-msg', role: 'user', content: '三', ts: 3, archived: 0 })
    const rows = listUnarchivedMessages('c-msg')
    expect(rows.map((r) => r.content)).toEqual(['一', '二', '三'])
    expect(latestMessageId('c-msg')).toBe(rows[2].id)

    const archived = archiveMessagesRange('c-msg', rows[0].id!, rows[1].id!)
    expect(archived).toBe(2)
    expect(listUnarchivedMessages('c-msg').map((r) => r.content)).toEqual(['三'])

    clearCharacterMessages('c-msg')
    expect(listUnarchivedMessages('c-msg')).toHaveLength(0)
    expect(latestMessageId('c-msg')).toBeNull()
  })

  it('替换未归档消息与批量写入', () => {
    replaceUnarchivedMessages('c-replace', [
      { id: 10, character_id: 'c-replace', role: 'user', content: '旧', ts: 1, archived: 0 },
      { character_id: 'c-replace', role: 'assistant', content: '新', ts: 2, archived: 0 },
    ])
    const rows = listUnarchivedMessages('c-replace')
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe(10)
    expect(rows[1].content).toBe('新')

    saveChatMessages('c-chat', [{ role: 'user' }, { role: 'assistant' }])
    const chat = listUnarchivedMessages('c-chat')
    expect(chat).toHaveLength(2)
    expect(JSON.parse(chat[0].content).role).toBe('user')
    expect(JSON.parse(chat[1].content).role).toBe('assistant')
  })

  it('摘要追加与读取', () => {
    addSummary('c-sum', { start_ts: 1, end_ts: 2, text: '第一段', message_count: 2 })
    addSummary('c-sum', { start_ts: 3, end_ts: 4, text: '第二段', message_count: 2 })
    const summaries = listSummaries('c-sum')
    expect(summaries).toHaveLength(2)
    expect(summaries.map((s) => s.text)).toEqual(expect.arrayContaining(['第一段', '第二段']))
  })

  it('事实增量更新覆盖印证、否定、状态、冻结、向量与删除', () => {
    insertFactRow('c-fact', fact('f1'))
    expect(getFactRow('f1')?.text).toBe('事实 f1')

    expect(reinforceFactRow('f1', '2026-02-01T00:00:00.000Z')).toBe(1)
    expect(getFactRow('f1')).toMatchObject({
      last_confirmed_at: '2026-02-01T00:00:00.000Z',
      evidence_reinforce: 1,
    })

    expect(negateFactRow('f1')).toBe(1)
    expect(getFactRow('f1')).toMatchObject({ status: 'archived', evidence_negate: 1 })

    expect(setFactStatusRow('f1', 'active')).toBe(1)
    expect(setFactFrozenRow('f1', '2026-03-01T00:00:00.000Z')).toBe(1)
    expect(setFactEmbeddingRow('f1', '[0.1,0.2]')).toBe(1)
    expect(getFactRow('f1')).toMatchObject({
      status: 'active',
      frozen_at: '2026-03-01T00:00:00.000Z',
      embedding: '[0.1,0.2]',
    })

    expect(deleteFactRow('f1')).toBe(1)
    expect(getFactRow('f1')).toBeNull()
  })

  it('事实整表替换只影响指定角色', () => {
    insertFactRow('c-fact-a', fact('fa', { character_id: 'c-fact-a' }))
    insertFactRow('c-fact-b', fact('fb', { character_id: 'c-fact-b' }))
    saveFacts('c-fact-a', [fact('fa2', { character_id: 'c-fact-a', text: '替换后' })])
    expect(listFacts('c-fact-a').map((f) => f.text)).toEqual(['替换后'])
    expect(listFacts('c-fact-b').map((f) => f.text)).toEqual(['事实 fb'])
  })

  it('故事增量、整表替换与清理', () => {
    insertStoryRow('c-story', story('s1'))
    insertStoryRow('c-story', story('s2', { kind: 'promise', due_at: '2026-12-01' }))
    expect(listStories('c-story')).toHaveLength(2)
    expect(setStoryStatusRow('s1', 'archived')).toBe(1)
    expect(listStories('c-story').find((s) => s.id === 's1')?.status).toBe('archived')

    saveStories('c-story', [story('s3', { text: '只剩一条' })])
    expect(listStories('c-story').map((s) => s.text)).toEqual(['只剩一条'])

    clearCharacterMemory('c-story')
    expect(listStories('c-story')).toHaveLength(0)
  })

  it('清理角色记忆不会误删消息', () => {
    appendMessage({ character_id: 'c-clear', role: 'user', content: '保留', ts: 1, archived: 0 })
    insertFactRow('c-clear', fact('fc', { character_id: 'c-clear' }))
    insertStoryRow('c-clear', story('sc', { character_id: 'c-clear' }))
    clearCharacterMemory('c-clear')
    expect(listFacts('c-clear')).toHaveLength(0)
    expect(listStories('c-clear')).toHaveLength(0)
    expect(listUnarchivedMessages('c-clear')).toHaveLength(1)
  })

  it('追加消息返回数据库 ID，顺序与输入一致', () => {
    const ids = saveChatMessages('c-append-ids', [{ role: 'user' }, { role: 'assistant' }])
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBeGreaterThan(ids[0])
    expect(listUnarchivedMessages('c-append-ids').map((r) => r.id)).toEqual(ids)
  })

  it('空输入返回空数组', () => {
    expect(saveChatMessages('c-empty', [])).toEqual([])
  })

  it('压缩提交同时写入摘要与归档', () => {
    const ids = saveChatMessages('c-compact', [{ role: 'user' }, { role: 'assistant' }])
    const res = commitCompression('c-compact', ids[0], ids[1], {
      text: '摘要',
      message_count: 2,
      start_ts: 1,
      end_ts: 2,
    })
    expect(res.archived).toBe(2)
    expect(listSummaries('c-compact')).toHaveLength(1)
    expect(listUnarchivedMessages('c-compact')).toHaveLength(0)
  })

  it('重复提交同一区间不再插入摘要', () => {
    const ids = saveChatMessages('c-compact-twice', [{ role: 'user' }])
    const summary = { text: 'a', message_count: 1, start_ts: 1, end_ts: 1 }
    expect(commitCompression('c-compact-twice', ids[0], ids[0], summary).archived).toBe(1)
    const again = commitCompression('c-compact-twice', ids[0], ids[0], {
      ...summary,
      text: 'b',
    })
    expect(again.archived).toBe(0)
    expect(listSummaries('c-compact-twice')).toHaveLength(1)
  })
})
