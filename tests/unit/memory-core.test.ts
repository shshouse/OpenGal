import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from '../../src/main/services/memoryDb'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-core-'))

interface MemoryRow {
  id: string
  character_id: string
  kind: 'fact' | 'event' | 'promise'
  text: string
  state: 'active' | 'superseded' | 'archived' | 'fulfilled' | 'cancelled'
  importance: number
  happened_at: number | null
  created_at: number
  source_from: number | null
  source_to: number | null
  supersedes: string | null
  pinned: number
  embedding: string | null
}

const api = db as unknown as {
  insertMemoryRow?: (characterId: string, row: MemoryRow) => void
  listMemoryRows?: (characterId: string, opts?: { includeInactive?: boolean }) => MemoryRow[]
  setMemoryStateRow?: (id: string, state: MemoryRow['state']) => number
  setMemoryPinnedRow?: (id: string, pinned: boolean) => number
  searchMessages?: (
    characterId: string,
    query: string,
    opts?: { fromTs?: number; toTs?: number; limit?: number; radius?: number },
  ) => Array<{ id: number; character_id: string; role: string; content: string; ts: number; kind: string }>
}

function memory(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: 'm1',
    character_id: 'c1',
    kind: 'fact',
    text: '用户住在北京',
    state: 'active',
    importance: 3,
    happened_at: null,
    created_at: 1_700_000_000_000,
    source_from: 1,
    source_to: 2,
    supersedes: null,
    pinned: 0,
    embedding: null,
    ...overrides,
  }
}

function seed(characterId: string, role: string, text: string, ts: number, kind = 'chat') {
  db.appendMessage({
    character_id: characterId,
    role,
    content: JSON.stringify({ role, content: text }),
    ts,
    archived: 1,
    kind,
  } as never)
}

describe('记忆地基', () => {
  beforeAll(async () => {
    await db.initMemoryDb(root)
    await db.memoryDbReady()
  })

  afterAll(() => {
    db.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('memories 单表可写入、按角色读取、区分当前与已取代', () => {
    expect(api.insertMemoryRow).toBeTypeOf('function')
    api.insertMemoryRow!('c1', memory())
    api.insertMemoryRow!('c1', memory({ id: 'm2', text: '用户搬到上海', supersedes: 'm1' }))
    api.insertMemoryRow!('c2', memory({ id: 'm3', character_id: 'c2', text: '别的角色' }))

    const active = api.listMemoryRows!('c1')
    expect(active.map((row) => row.id).sort()).toEqual(['m1', 'm2'])

    expect(api.setMemoryStateRow!('m1', 'superseded')).toBe(1)
    expect(api.listMemoryRows!('c1').map((row) => row.id)).toEqual(['m2'])

    const all = api.listMemoryRows!('c1', { includeInactive: true })
    expect(all).toHaveLength(2)
    expect(all.find((row) => row.id === 'm1')?.state).toBe('superseded')

    expect(api.listMemoryRows!('c2').map((row) => row.id)).toEqual(['m3'])
  })

  it('pinned 在归档后仍然可见', () => {
    api.insertMemoryRow!('c1', memory({ id: 'm4', text: '用户对猫毛过敏', importance: 5 }))
    expect(api.setMemoryPinnedRow!('m4', true)).toBe(1)
    expect(api.setMemoryStateRow!('m4', 'archived')).toBe(1)
    const all = api.listMemoryRows!('c1', { includeInactive: true })
    expect(all.find((row) => row.id === 'm4')?.pinned).toBe(1)
  })

  it('同一条消息重复写入不会产生两条', () => {
    const item = {
      character_id: 'c-dup',
      role: 'user',
      content: JSON.stringify({ role: 'user', content: '重复的一句话' }),
      ts: 1000,
      archived: 0,
      kind: 'chat',
    }
    expect(db.appendMissingMessages('c-dup', [item] as never)).toBe(1)
    expect(db.appendMissingMessages('c-dup', [item] as never)).toBe(0)
  })

  it('中文按相邻双字建索引，跨词查询也能命中', () => {
    seed('c-fts', 'user', '我养了一只橘猫，名字叫年糕', 10)
    seed('c-fts', 'user', '今天加班到很晚', 20)

    expect(api.searchMessages).toBeTypeOf('function')
    const hits = api.searchMessages!('c-fts', '猫 年糕', { radius: 0 })
    expect(hits).toHaveLength(1)
    expect(hits[0].content).toContain('橘猫')

    expect(api.searchMessages!('c-fts', '加班', { radius: 0 })).toHaveLength(1)
    expect(api.searchMessages!('c-fts', '量子力学', { radius: 0 })).toHaveLength(0)
  })

  it('命中时带出相邻消息，便于理解上下文', () => {
    const withNeighbors = api.searchMessages!('c-fts', '加班')
    expect(withNeighbors.length).toBeGreaterThan(1)
    expect(withNeighbors.some((row) => row.content.includes('橘猫'))).toBe(true)
  })

  it('observation 消息可检索但与聊天区分', () => {
    seed('c-obs', 'assistant', '用户正在写代码，屏幕上是编辑器', 30, 'observation')
    const hits = api.searchMessages!('c-obs', '编辑器', { radius: 0 })
    expect(hits).toHaveLength(1)
    expect(hits[0].kind).toBe('observation')
  })

  it('检索不跨角色', () => {
    seed('c-a', 'user', '我喜欢喝美式', 40)
    seed('c-b', 'user', '我也喜欢喝美式', 50)
    const hits = api.searchMessages!('c-a', '美式', { radius: 0 })
    expect(hits).toHaveLength(1)
    expect(hits[0].character_id).toBe('c-a')
  })

  it('时间范围过滤只返回范围内消息', () => {
    seed('c-time', 'user', '三月说要去南京', Date.UTC(2024, 2, 1))
    seed('c-time', 'user', '七月又说要去南京', Date.UTC(2024, 6, 1))
    const hits = api.searchMessages!('c-time', '南京', {
      fromTs: Date.UTC(2024, 6, 1),
      toTs: Date.UTC(2024, 7, 1),
      radius: 0,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].ts).toBe(Date.UTC(2024, 6, 1))
  })
})
