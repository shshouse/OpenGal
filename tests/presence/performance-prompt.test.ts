import { describe, expect, it } from 'vitest'
import { buildDynamicContextBlock, buildSystemPrompt } from '@shared/role/prompt'
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

  it('把皮套当前状态写进提示词', () => {
    const prompt = buildSystemPrompt(card, [], undefined, false, ['neutral'], {
      stage: { outfit: '常服', expression: 'surprised', motion: 'wave', speaking: true },
    })
    expect(prompt).toContain('【你此刻的皮套】')
    expect(prompt).toContain('服装 常服')
    expect(prompt).toContain('表情 surprised')
    expect(prompt).toContain('动作 wave')
    expect(prompt).toContain('正在说话')
  })

  it('没有皮套信息时不写空块', () => {
    const prompt = buildSystemPrompt(card, [], undefined, false, ['neutral'], { stage: {} })
    expect(prompt).not.toContain('【你此刻的皮套】')
  })

  it('稳定提示不含易变状态，易变内容单独成块', () => {
    const state = {
      mood: '平静',
      energy: 70,
      relationshipStage: '信任',
      currentActivity: '整理报告',
      shortTermGoal: '',
      nextTickAt: null,
      updatedAt: Date.now(),
    }
    const stable = buildSystemPrompt(card, [], '【你记得的事】\n用户喜欢猫', false, ['neutral'], {
      omitDynamic: true,
      selfState: state,
      stage: { expression: 'happy' },
    })
    expect(stable).not.toContain('【你记得的事】')
    expect(stable).not.toContain('【你此刻的自身状态】')
    expect(stable).not.toContain('【你此刻的皮套】')

    const dynamic = buildDynamicContextBlock({
      selfState: state,
      stage: { expression: 'happy', outfit: '常服' },
      memoryBlock: '【你记得的事】\n用户喜欢猫',
    })
    expect(dynamic).toContain('【你此刻的自身状态】')
    expect(dynamic).toContain('【你此刻的皮套】')
    expect(dynamic).toContain('【你记得的事】')
  })

  it('角色自带示例只出现一次，且不重复追加表情标签', () => {
    const withExample = {
      ...card,
      examples: [{ user: '今天好累', assistant: '<e:neutral>那就休息。' }],
    } as RoleCard
    const prompt = buildSystemPrompt(withExample, [], undefined, false, ['neutral'])
    expect(prompt.split('<e:neutral>那就休息。')).toHaveLength(2)
    expect(prompt).not.toContain('<e:neutral><e:neutral>')
  })
})
