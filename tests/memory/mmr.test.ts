import { describe, expect, it } from 'vitest'
import { assembleBlock } from '../../src/main/services/memory/recall/recall'
import type { Memory } from '../../src/main/services/memory/model/model'

const NOW = Date.UTC(2026, 10, 24, 4, 0)

function memory(over: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    roleId: 'c1',
    kind: 'fact',
    episodeKind: null,
    text: '用户的猫叫年糕',
    entity: 'user',
    subject: '用户',
    attribute: '猫的名字',
    value: '年糕',
    negated: false,
    importance: 5,
    source: 'user_statement',
    state: 'active',
    happenedAt: null,
    dueAt: null,
    validFrom: new Date(NOW).toISOString(),
    invalidAt: null,
    confirmedAt: NOW - 86_400_000,
    evidence: { reinforce: 0, negate: 0 },
    pinned: false,
    frozen: false,
    embedding: null,
    createdAt: NOW - 86_400_000,
    ...over,
  }
}

describe('记忆注入去冗余', () => {
  it('预算只够两条时，同义事实只留一条，把位置让给不同事实', () => {
    const memories = [
      memory({ id: 'a', text: '用户喜欢喝美式咖啡', attribute: '饮品', value: '美式咖啡', importance: 9 }),
      memory({ id: 'b', text: '用户喜欢喝美式咖啡不加糖', attribute: '口味', value: '不加糖', importance: 8 }),
      memory({ id: 'c', text: '用户养了一只叫年糕的橘猫', attribute: '宠物', value: '橘猫', importance: 6 }),
    ]

    const block = assembleBlock(memories, null, { charCap: 21, now: NOW }) ?? ''

    expect(block.match(/美式咖啡/g)).toHaveLength(1)
    expect(block).not.toContain('不加糖')
    expect(block).toContain('年糕')
  })

  it('没有重复时保持原有分数顺序', () => {
    const memories = [
      memory({ id: 'a', text: '用户喜欢喝美式咖啡', attribute: '饮品', value: '美式咖啡', importance: 9 }),
      memory({ id: 'c', text: '用户养了一只叫年糕的橘猫', attribute: '宠物', value: '橘猫', importance: 6 }),
      memory({ id: 'd', text: '用户在北京上班', attribute: '城市', value: '北京', importance: 4 }),
    ]

    const block = assembleBlock(memories, null, { charCap: 21, now: NOW }) ?? ''

    expect(block.indexOf('美式咖啡')).toBeLessThan(block.indexOf('年糕'))
    expect(block).not.toContain('北京')
  })

  it('只有一条记忆时原样输出', () => {
    const block = assembleBlock([memory({ text: '用户对花生过敏' })], null, { charCap: 900, now: NOW })
    expect(block).toContain('用户对花生过敏')
  })

  it('约定类不参与去重，措辞相近的两条承诺都保留', () => {
    const due = '2026-11-25T00:00:00.000Z'
    const memories = [
      memory({
        id: 'p1',
        kind: 'episode',
        episodeKind: 'promise',
        entity: 'relationship',
        subject: null,
        attribute: null,
        value: null,
        text: '明天叫他起床',
        dueAt: due,
        importance: 8,
      }),
      memory({
        id: 'p2',
        kind: 'episode',
        episodeKind: 'promise',
        entity: 'relationship',
        subject: null,
        attribute: null,
        value: null,
        text: '明天叫他起床吧',
        dueAt: due,
        importance: 7,
      }),
      memory({
        id: 'e1',
        kind: 'episode',
        episodeKind: 'event',
        entity: 'relationship',
        subject: null,
        attribute: null,
        value: null,
        text: '今天一起看了电影',
        importance: 5,
      }),
    ]

    const block = assembleBlock(memories, null, { charCap: 60, now: NOW }) ?? ''

    expect(block.match(/约定：/g)).toHaveLength(2)
    expect(block).not.toContain('电影')
  })
})
