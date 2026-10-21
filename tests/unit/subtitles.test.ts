import { describe, expect, it } from 'vitest'
import { languageCode, roleSpeechLanguage, subtitleText } from '@shared/subtitles'
import { buildSystemPrompt } from '@shared/roleCard'

describe('subtitles', () => {
  it('归一化语言代码并拒绝不支持的合成语言', () => {
    expect(languageCode('zh_CN')).toBe('zh')
    expect(languageCode('ja-JP')).toBe('ja')
    expect(languageCode('not a language')).toBe('')
    expect(roleSpeechLanguage('ja-JP')).toBe('ja')
    expect(() => roleSpeechLanguage('fr')).toThrow(/不支持/)
  })

  it('按模式拼接原文与译文', () => {
    const segments = [
      { id: 'first', text: 'こんにちは。', translation: '你好。' },
      { id: 'second', text: '元気？' },
    ]
    expect(subtitleText(segments, 'off')).toBe('こんにちは。元気？')
    expect(subtitleText(segments, 'translated')).toBe('你好。元気？')
    expect(subtitleText(segments, 'bilingual')).toBe('こんにちは。元気？\n你好。元気？')
    expect(subtitleText([{ id: 'pending', text: '原文' }], 'bilingual')).toBe('原文')
    expect(subtitleText([], 'translated')).toBe('')
  })
})

describe('buildSystemPrompt', () => {
  it('把角色语言与"不附翻译"要求写进提示词', () => {
    const prompt = buildSystemPrompt({
      id: 'test',
      name: 'test',
      language: 'ja',
      windowMode: 'pet',
      performance: { mode: 'auto' },
      persona: { description: 'test', personality: 'test' },
    } as Parameters<typeof buildSystemPrompt>[0])
    expect(prompt).toContain('台词必须使用 ja 语言')
    expect(prompt).toContain('只输出角色原文，不附翻译')
  })
})
