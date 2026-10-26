import { describe, expect, it } from 'vitest'
import {
  decide,
  parseVerdict,
  pickTarget,
  sameSlotDedupe,
  scoreOf,
  wantsHistory,
  type FactLike,
} from '../../src/main/services/memoryArbitration'

function fact(over: Partial<FactLike>): FactLike {
  return {
    id: 'f1',
    text: '',
    entity: 'user',
    importance: 5,
    confidence: 1,
    source: 'user_statement',
    created_at: '2026-10-01T00:00:00.000Z',
    last_confirmed_at: '2026-10-01T00:00:00.000Z',
    status: 'active',
    evidence: { reinforce: 0, negate: 0 },
    valid_until: null,
    frozen_at: null,
    ...over,
  }
}

describe('memory arbitration', () => {
  it('槽位命中优先于字面相似：改城市也能找到旧值', () => {
    const city = fact({ id: 'a', text: '用户住在北京', subject: '用户', attribute: '居住城市' })
    const hit = pickTarget(
      { text: '用户住在上海', entity: 'user', subject: '用户', attribute: '居住城市' },
      [city],
    )
    expect(hit?.target.id).toBe('a')
    expect(hit?.via).toBe('slot')
  })

  it('否定句能命中同槽位旧值', () => {
    const coffee = fact({ id: 'a', text: '用户喜欢咖啡', subject: '用户', attribute: '喜欢的饮料' })
    expect(
      pickTarget(
        { text: '用户不喜欢咖啡了', entity: 'user', subject: '用户', attribute: '喜欢的饮料' },
        [coffee],
      )?.target.id,
    ).toBe('a')
  })

  it('没有槽位时退回相似度，只用于找候选', () => {
    const coffee = fact({ id: 'a', text: '用户喜欢咖啡' })
    expect(pickTarget({ text: '用户喜欢喝咖啡', entity: 'user' }, [coffee])?.via).toBe('similarity')
    expect(pickTarget({ text: '用户在准备考试', entity: 'user' }, [coffee])).toBeNull()
  })

  it('判决映射：重复强化、矛盾替代、补充与无关都新增', () => {
    expect(decide('duplicate')).toBe('reinforce')
    expect(decide('contradicts')).toBe('supersede')
    expect(decide('refines')).toBe('insert')
    expect(decide('unrelated')).toBe('insert')
  })

  it('裁判输出异常一律按无关处理，绝不默认强化', () => {
    expect(parseVerdict('negates')).toBe('unrelated')
    expect(parseVerdict(undefined)).toBe('unrelated')
    expect(parseVerdict('contradicts')).toBe('contradicts')
  })

  it('同一槽位只让一条进入提示词，保留最新的', () => {
    const old = fact({ id: 'old', text: '用户住在北京', subject: '用户', attribute: '居住城市', last_confirmed_at: '2025-01-01T00:00:00.000Z' })
    const fresh = fact({ id: 'new', text: '用户住在上海', subject: '用户', attribute: '居住城市', last_confirmed_at: '2026-10-01T00:00:00.000Z' })
    expect(sameSlotDedupe([old, fresh]).map((f) => f.id)).toEqual(['new'])
  })

  it('冻结的记忆在去重时优先保留', () => {
    const frozen = fact({ id: 'pin', text: '用户的生日是3月15日', subject: '用户', attribute: '生日', frozen_at: '2026-01-01T00:00:00.000Z', importance: 3 })
    const loose = fact({ id: 'loose', text: '用户的生日是3月16日', subject: '用户', attribute: '生日', importance: 10 })
    expect(sameSlotDedupe([frozen, loose]).map((f) => f.id)).toEqual(['pin'])
  })

  it('只有问及过去时才召回历史', () => {
    expect(wantsHistory('你还记得我以前住哪吗')).toBe(true)
    expect(wantsHistory('上次说的那家店')).toBe(true)
    expect(wantsHistory('今天吃什么')).toBe(false)
  })

  it('推断来源的分数低于用户原话，证据累积能加分', () => {
    const base = fact({ text: '用户喜欢咖啡' })
    expect(scoreOf({ ...base, source: 'llm_inferred' })).toBeLessThan(scoreOf(base))
    expect(scoreOf({ ...base, evidence: { reinforce: 5, negate: 0 } })).toBeGreaterThan(scoreOf(base))
  })
})
