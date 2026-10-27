import { describe, expect, it } from 'vitest'
import { parseDirectorDecision } from '../../src/renderer/src/features/pipeline/directorContract'

describe('导演决策解析', () => {
  it('speak 可以携带台词', () => {
    const decision = parseDirectorDecision('{"action":"speak","line":"你回来了。","reason":"刚回来"}')
    expect(decision.action).toMatchObject({ type: 'speak', line: '你回来了。' })
  })

  it('没有台词时 speak 不带 line 字段', () => {
    const decision = parseDirectorDecision('{"action":"speak","reason":"用户提问"}')
    expect(decision.action.type).toBe('speak')
    expect((decision.action as { line?: string }).line).toBeUndefined()
  })

  it('空字符串或非字符串台词被忽略', () => {
    const empty = parseDirectorDecision('{"action":"speak","line":"   "}')
    expect((empty.action as { line?: string }).line).toBeUndefined()
    const wrong = parseDirectorDecision('{"action":"speak","line":123}')
    expect((wrong.action as { line?: string }).line).toBeUndefined()
  })

  it('超长台词截断到 200 字', () => {
    const long = '啊'.repeat(400)
    const decision = parseDirectorDecision(JSON.stringify({ action: 'speak', line: long }))
    expect((decision.action as { line?: string }).line).toHaveLength(200)
  })

  it('未知动作仍然降级为沉默', () => {
    expect(parseDirectorDecision('{"action":"dance"}').action.type).toBe('silent')
  })
})
