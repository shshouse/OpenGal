import { describe, expect, it } from 'vitest'
import {
  createProactiveBudget,
  framePerception,
  isActionAllowed,
  parseDirectorDecision,
  sanitizeTrust,
  type PerceptionEvent,
} from '@/features/pipeline/directorContract'

const NOW = 1_700_000_000_000

function utterance(overrides: Partial<Extract<PerceptionEvent, { kind: 'utterance' }>> = {}) {
  const event: PerceptionEvent = {
    id: `u-${Math.random()}`,
    kind: 'utterance',
    at: NOW,
    ttlMs: 120_000,
    trusted: true,
    text: '你好',
    addressee: 'her',
    ...overrides,
  }
  return event
}

describe('parseDirectorDecision', () => {
  it('把旧枚举映射到新动作', () => {
    expect(parseDirectorDecision('{"action":"respond","reason":"在叫我"}').action).toEqual({
      type: 'speak',
      interrupt: false,
    })
    expect(parseDirectorDecision('{"action":"silence","reason":"自言自语"}').action.type).toBe('silent')
    expect(parseDirectorDecision('{"action":"wait","waitSec":6,"reason":"没说完"}').action).toEqual({
      type: 'wait',
      waitSec: 6,
      why: '没说完',
    })
  })

  it('等待秒数被夹在 2 到 15 之间', () => {
    const low = parseDirectorDecision('{"action":"wait","waitSec":0}')
    const high = parseDirectorDecision('{"action":"wait","waitSec":999}')
    expect(low.action).toMatchObject({ type: 'wait', waitSec: 2 })
    expect(high.action).toMatchObject({ type: 'wait', waitSec: 15 })
  })

  it('无法解析时一律沉默，绝不默认开口', () => {
    for (const raw of ['', '随便说点什么', '{坏掉的 json}', '{"action":"fly"}', '{"action":null}']) {
      expect(parseDirectorDecision(raw).action.type).toBe('silent')
    }
  })

  it('保留动作降级为沉默并保留原因', () => {
    const res = parseDirectorDecision('{"action":"browse","reason":"想查一下"}')
    expect(res.action.type).toBe('silent')
    expect(res.reason).toBe('想查一下')
  })

  it('缺省 reason 时仍能给出可读原因', () => {
    const res = parseDirectorDecision('{"action":"speak"}')
    expect(res.action.type).toBe('speak')
    expect(res.reason).toBe('')
  })
})

describe('framePerception', () => {
  it('丢弃过期事件并保持时间顺序', () => {
    const fresh = utterance({ id: 'a', at: NOW - 1_000 })
    const stale = utterance({ id: 'b', at: NOW - 200_000, ttlMs: 120_000 })
    const result = framePerception([fresh, stale], NOW)
    expect(result.map((e) => e.id)).toEqual(['a'])
  })

  it('超过上限时只保留最近的若干条', () => {
    const events = Array.from({ length: 5 }, (_, i) => utterance({ id: `e${i}`, at: NOW - (5 - i) * 100 }))
    expect(framePerception(events, NOW, 2).map((e) => e.id)).toEqual(['e3', 'e4'])
  })
})

describe('sanitizeTrust', () => {
  it('强制把外部内容标为不可信', () => {
    const web = sanitizeTrust({
      id: 'w1',
      kind: 'web',
      at: NOW,
      ttlMs: 60_000,
      trusted: true,
      site: 'example.com',
      title: '页面',
      excerpt: '正文',
      untrusted: true,
    } as PerceptionEvent)
    expect(web.trusted).toBe(false)
  })

  it('语音事件保持可信', () => {
    expect(sanitizeTrust(utterance()).trusted).toBe(true)
  })
})

describe('createProactiveBudget', () => {
  it('perHour <= 0 时视为不限', () => {
    const budget = createProactiveBudget({ perHour: 0, cooldownMs: 0 })
    for (let i = 0; i < 50; i += 1) expect(budget.take(NOW + i)).toBe(true)
    expect(budget.remaining(NOW)).toBe(Number.POSITIVE_INFINITY)
  })

  it('限制每小时主动次数并支持退还', () => {
    const budget = createProactiveBudget({ perHour: 2, cooldownMs: 0 })
    expect(budget.take(NOW)).toBe(true)
    expect(budget.take(NOW + 1)).toBe(true)
    expect(budget.take(NOW + 2)).toBe(false)
    budget.refund()
    expect(budget.take(NOW + 3)).toBe(true)
  })

  it('冷却时间内不再放行', () => {
    const budget = createProactiveBudget({ perHour: 10, cooldownMs: 60_000 })
    expect(budget.take(NOW)).toBe(true)
    expect(budget.take(NOW + 30_000)).toBe(false)
    expect(budget.take(NOW + 61_000)).toBe(true)
  })
})

describe('isActionAllowed', () => {
  const base = {
    self: { doing: 'idle' },
    constraints: { proactiveBudgetLeft: 5, canInterrupt: true, userFocused: false },
  }

  it('安静模式压过一切主动行为', () => {
    const quiet = { ...base, self: { doing: 'idle', quietUntil: NOW + 60_000 } }
    expect(isActionAllowed({ type: 'speak' }, quiet, NOW)).toBe(false)
    expect(isActionAllowed({ type: 'silent', why: 'x' }, quiet, NOW)).toBe(true)
  })

  it('预算耗尽时不开口', () => {
    const empty = { ...base, constraints: { ...base.constraints, proactiveBudgetLeft: 0 } }
    expect(isActionAllowed({ type: 'speak' }, empty, NOW)).toBe(false)
  })

  it('不允许打断时阻止打断型发言', () => {
    const noInterrupt = { ...base, constraints: { ...base.constraints, canInterrupt: false } }
    expect(isActionAllowed({ type: 'speak', interrupt: true }, noInterrupt, NOW)).toBe(false)
    expect(isActionAllowed({ type: 'speak' }, noInterrupt, NOW)).toBe(true)
  })
})
