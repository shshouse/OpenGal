import { describe, expect, it } from 'vitest'
import {
  cardinalityOf,
  resolveCurrent,
  scoreOf,
  slotOf,
  wantsHistory,
  type FactLike,
} from '../../src/main/services/memoryArbitration'

function fact(over: Partial<FactLike>): FactLike {
  return {
    id: 'f1',
    text: '',
    entity: 'user',
    subject: '用户',
    importance: 5,
    confidence: 1,
    source: 'user_statement',
    created_at: '2026-01-01T00:00:00.000Z',
    last_confirmed_at: '2026-01-01T00:00:00.000Z',
    valid_from: '2026-01-01T00:00:00.000Z',
    status: 'active',
    evidence: { reinforce: 0, negate: 0 },
    valid_until: null,
    frozen_at: null,
    ...over,
  }
}

describe('memory resolution', () => {
  it('单值谓词：后来者替换前者，旧值进历史', () => {
    const [state] = resolveCurrent([
      fact({ id: 'a', text: '用户住在北京', attribute: '居住城市', valid_from: '2025-01-01T00:00:00.000Z' }),
      fact({ id: 'b', text: '用户住在上海', attribute: '居住城市', valid_from: '2026-01-01T00:00:00.000Z' }),
    ])
    expect(state.current.map((item) => item.id)).toEqual(['b'])
    expect(state.history.map((item) => item.id)).toEqual(['a'])
  })

  it('多值谓词：不同宾语并存，同一宾语取最新', () => {
    const states = resolveCurrent([
      fact({ id: 'a', text: '用户喜欢咖啡', attribute: '喜欢的饮料', object: '咖啡', valid_from: '2026-01-01T00:00:00.000Z' }),
      fact({ id: 'b', text: '用户喜欢茶', attribute: '喜欢的饮料', object: '茶', valid_from: '2026-01-02T00:00:00.000Z' }),
      fact({ id: 'c', text: '用户喜欢咖啡', attribute: '喜欢的饮料', object: '咖啡', valid_from: '2026-01-03T00:00:00.000Z' }),
    ])
    expect(states[0].current.map((item) => item.object).sort()).toEqual(['咖啡', '茶'])
    expect(states[0].current.map((item) => item.id)).not.toContain('a')
  })

  it('否定之后不再成立，但历史保留', () => {
    const [state] = resolveCurrent([
      fact({ id: 'a', text: '用户喜欢咖啡', attribute: '喜欢的饮料', object: '咖啡', valid_from: '2026-01-01T00:00:00.000Z' }),
      fact({ id: 'b', text: '用户不喜欢咖啡了', attribute: '喜欢的饮料', object: '咖啡', polarity: false, valid_from: '2026-02-01T00:00:00.000Z' }),
    ])
    expect(state.current).toHaveLength(0)
    expect(state.history.map((item) => item.id).sort()).toEqual(['a', 'b'])
  })

  it('推断不能覆盖同一槽位里的用户原话', () => {
    const [state] = resolveCurrent([
      fact({ id: 'a', text: '用户住在北京', attribute: '居住城市', source: 'user_statement', valid_from: '2026-01-01T00:00:00.000Z' }),
      fact({ id: 'b', text: '用户住在上海', attribute: '居住城市', source: 'llm_inferred', valid_from: '2026-02-01T00:00:00.000Z' }),
    ])
    expect(state.current.map((item) => item.id)).toEqual(['a'])
  })

  it('钉住的记忆优先于更新的观测', () => {
    const [state] = resolveCurrent([
      fact({ id: 'a', text: '用户的生日是3月15日', attribute: '生日', frozen_at: '2026-01-01T00:00:00.000Z' }),
      fact({ id: 'b', text: '用户的生日是3月16日', attribute: '生日', valid_from: '2026-05-01T00:00:00.000Z' }),
    ])
    expect(state.current.map((item) => item.id)).toEqual(['a'])
  })

  it('没有槽位的老数据各自成槽，不互相吞并', () => {
    const states = resolveCurrent([
      fact({ id: 'a', text: '用户的猫叫小饼', subject: null, attribute: null }),
      fact({ id: 'b', text: '用户去年喜欢打篮球', subject: null, attribute: null }),
    ])
    expect(states).toHaveLength(2)
    expect(states.flatMap((state) => state.current).map((item) => item.id).sort()).toEqual(['a', 'b'])
  })

  it('谓词基数：常见单值词命中，其余默认多值', () => {
    expect(cardinalityOf('居住城市')).toBe('single')
    expect(cardinalityOf('生日')).toBe('single')
    expect(cardinalityOf('喜欢的饮料')).toBe('multi')
    expect(cardinalityOf('')).toBe('multi')
  })

  it('槽位键包含实体与主语，缺项时退化为独立槽', () => {
    expect(slotOf(fact({ id: 'x', attribute: '生日' }))).toBe('user|用户|生日')
    expect(slotOf(fact({ id: 'y', attribute: null }))).toBe('legacy:y')
  })

  it('只有问及过去时才召回历史', () => {
    expect(wantsHistory('你还记得我以前住哪吗')).toBe(true)
    expect(wantsHistory('今天吃什么')).toBe(false)
  })

  it('推断来源与未确认证据的分数更低', () => {
    const base = fact({ text: '用户喜欢咖啡' })
    expect(scoreOf({ ...base, source: 'llm_inferred' })).toBeLessThan(scoreOf(base))
    expect(scoreOf({ ...base, evidence: { reinforce: 5, negate: 0 } })).toBeGreaterThan(scoreOf(base))
  })
})
