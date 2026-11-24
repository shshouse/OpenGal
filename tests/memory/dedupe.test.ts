import { describe, expect, it } from 'vitest'
import type { Memory } from '../../src/main/services/memory/model/model'
import {
  EPISODE_MERGE_WINDOW_MS,
  findRepeatedEpisode,
  isRepeatedFact,
} from '../../src/main/services/memory/store/dedupe'

const NOW = Date.UTC(2026, 10, 24, 4, 0)

function memory(over: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    roleId: 'c1',
    kind: 'fact',
    episodeKind: null,
    text: '用户喜欢喝美式咖啡',
    entity: 'user',
    subject: '用户',
    attribute: '饮品',
    value: '美式咖啡',
    negated: false,
    importance: 6,
    source: 'user_statement',
    state: 'active',
    happenedAt: null,
    dueAt: null,
    validFrom: new Date(NOW).toISOString(),
    invalidAt: null,
    confirmedAt: NOW,
    evidence: { reinforce: 0, negate: 0 },
    pinned: false,
    frozen: false,
    embedding: null,
    createdAt: NOW,
    ...over,
  }
}

describe('写入去重：事实', () => {
  it('同一句话换个标点只算重复，不新增', () => {
    const existing = memory({ text: '用户喜欢喝美式咖啡' })
    const entry = memory({ id: 'm2', text: '用户喜欢喝美式咖啡。' })
    expect(isRepeatedFact(existing, entry)).toBe(true)
  })

  it('同槽位同极性，换个说法但向量接近，也算重复', () => {
    const existing = memory({ text: '用户喜欢喝美式咖啡', embedding: [1, 0, 0] })
    const entry = memory({ id: 'm2', text: '用户爱喝美式', embedding: [0.95, 0.05, 0] })
    expect(isRepeatedFact(existing, entry)).toBe(true)
  })

  it('同槽位但向量差得远，不合并', () => {
    const existing = memory({ text: '用户喜欢喝美式咖啡', embedding: [1, 0, 0] })
    const entry = memory({
      id: 'm2',
      text: '用户喜欢喝豆浆',
      value: '豆浆',
      embedding: [0, 1, 0],
    })
    expect(isRepeatedFact(existing, entry)).toBe(false)
  })

  it('一正一负绝不合并，哪怕措辞几乎一样', () => {
    const existing = memory({ text: '用户喜欢喝美式咖啡', embedding: [1, 0, 0] })
    const entry = memory({
      id: 'm2',
      text: '用户不喜欢喝美式咖啡',
      negated: true,
      embedding: [1, 0, 0],
    })
    expect(isRepeatedFact(existing, entry)).toBe(false)
  })

  it('不同属性的相似措辞不合并', () => {
    const existing = memory({ text: '用户喜欢喝美式咖啡', embedding: [1, 0, 0] })
    const entry = memory({
      id: 'm2',
      text: '用户喜欢喝美式咖啡',
      attribute: '口味',
      embedding: [1, 0, 0],
    })
    expect(isRepeatedFact(existing, entry)).toBe(false)
  })

  it('已归档的记忆不参与合并', () => {
    const existing = memory({ state: 'archived', embedding: [1, 0, 0] })
    const entry = memory({ id: 'm2', embedding: [1, 0, 0] })
    expect(isRepeatedFact(existing, entry)).toBe(false)
  })
})

describe('写入去重：情节', () => {
  const base = memory({
    kind: 'episode',
    episodeKind: 'event',
    entity: 'relationship',
    subject: null,
    attribute: null,
    value: null,
    text: '一起看了电影',
    happenedAt: NOW,
    embedding: [1, 0, 0],
  })

  it('一周内同类型且向量接近，合并', () => {
    const entry = memory({
      ...base,
      id: 'm2',
      text: '昨天一起去看了电影',
      happenedAt: NOW - 86_400_000,
      embedding: [0.95, 0.05, 0],
    })
    expect(findRepeatedEpisode([base], entry)?.id).toBe('m1')
  })

  it('超过一周的相似经历不算同一件事', () => {
    const entry = memory({
      ...base,
      id: 'm2',
      text: '一起看了电影',
      happenedAt: NOW + EPISODE_MERGE_WINDOW_MS + 1,
    })
    expect(findRepeatedEpisode([base], entry)).toBeNull()
  })

  it('承诺的截止时间不同就不合并', () => {
    const promise = memory({
      ...base,
      episodeKind: 'promise',
      text: '明天叫他起床',
      dueAt: '2026-11-25T00:00:00.000Z',
    })
    const entry = memory({
      ...base,
      id: 'm2',
      episodeKind: 'promise',
      text: '明天叫他起床',
      dueAt: '2026-11-26T00:00:00.000Z',
    })
    expect(findRepeatedEpisode([promise], entry)).toBeNull()
  })

  it('没有向量时退回字面判断', () => {
    const plain = memory({ ...base, embedding: null })
    const entry = memory({ ...base, id: 'm2', text: '一起看了电影。', embedding: null })
    expect(findRepeatedEpisode([plain], entry)?.id).toBe('m1')
  })
})
