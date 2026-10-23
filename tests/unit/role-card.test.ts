import { describe, expect, it } from 'vitest'
import {
  STANDARD_EMOTIONS,
  buildSystemPrompt,
  extractAssistantDisplayText,
} from '../../src/shared/roleCard'
import type { RoleCard } from '../../src/shared/types'

const card = {
  id: 'miku',
  name: 'Miku',
  displayName: '初音未来',
  language: 'ja',
  persona: {
    userIdentity: '制作人',
    userTerm: '你',
    description: '虚拟歌姬',
    personality: '温柔、认真',
    scenario: '录音室',
    rules: '不要自称 AI',
  },
} as unknown as RoleCard

describe('role card prompt', () => {
  it('拼装角色设定、用户身份与语言规则', () => {
    const prompt = buildSystemPrompt(card)
    expect(prompt).toContain('初音未来')
    expect(prompt).toContain('虚拟歌姬')
    expect(prompt).toContain('温柔、认真')
    expect(prompt).toContain('制作人')
    expect(prompt).toContain('台词必须使用 ja 语言')
    expect(prompt).toContain('不要自称 AI')
    expect(prompt).toContain(STANDARD_EMOTIONS.join(', '))
    expect(prompt).toContain('不要输出 <a:...> 动作标签')
    expect(prompt).not.toContain('工具使用规则')
  })

  it('注入记忆、动作菜单与工具规则', () => {
    const prompt = buildSystemPrompt(card, ['Idle', 'happy', 'custom'], '【你记得的事】\n用户喜欢猫', true)
    expect(prompt).toContain('【你记得的事】')
    expect(prompt).toContain('用户喜欢猫')
    expect(prompt).toContain('- "happy"：开心')
    expect(prompt).toContain('- "custom"：custom')
    expect(prompt).not.toContain('- "Idle"')
    expect(prompt).toContain('<a:happy>')
    expect(prompt).toContain('工具使用规则')
  })

  it('缺省称呼时回退到角色名', () => {
    const bare = {
      ...card,
      persona: { description: '歌姬', personality: '安静' },
    } as unknown as RoleCard
    const prompt = buildSystemPrompt(bare)
    expect(prompt).toContain('用户身份：用户；用户对你的称呼：Miku')
  })
})

describe('assistant display text', () => {
  it('支持纯文本、JSON、Markdown 围栏与数组', () => {
    expect(extractAssistantDisplayText('你好<e:happy>呀')).toBe('你好呀')
    expect(extractAssistantDisplayText('{"text":"你好","emotion":"happy"}')).toBe('你好')
    expect(extractAssistantDisplayText('```json\n{"text":"再见"}\n```')).toBe('再见')
    expect(extractAssistantDisplayText('[{"text":"a"},{"text":"b"}]')).toBe('ab')
    expect(extractAssistantDisplayText('  ')).toBe('')
  })
})
