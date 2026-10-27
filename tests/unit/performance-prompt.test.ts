import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../../src/shared/roleCard'
import type { RoleCard } from '../../src/shared/types'

const card: RoleCard = {
  id: 'c1',
  name: '凯尔希',
  displayName: '凯尔希',
  language: 'zh',
  persona: { description: '医生', personality: '冷静' },
  windowMode: 'theater',
} as RoleCard

describe('表演资源注入提示词', () => {
  it('只广告当前皮套真实存在的表情', () => {
    const prompt = buildSystemPrompt(card, [], undefined, false, ['neutral', 'happy', 'shy'])
    expect(prompt).toContain('neutral, happy, shy')
    expect(prompt).not.toContain('proud')
  })

  it('皮套没有表情时明确禁止输出表情标签', () => {
    const prompt = buildSystemPrompt(card, [], undefined, false, [])
    expect(prompt).toContain('不要输出 <e:')
  })

  it('没有动作组时禁止输出动作标签', () => {
    const prompt = buildSystemPrompt(card, [], undefined, false, ['neutral'])
    expect(prompt).toContain('不要输出 <a:')
  })

  it('有动作组时逐条列出', () => {
    const prompt = buildSystemPrompt(card, ['Idle', 'wave'], undefined, false, ['neutral'])
    expect(prompt).toContain('wave')
  })
})
