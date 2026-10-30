import { describe, expect, it } from 'vitest'
import { scriptLanguage, speechLanguageLabel, speechLanguageSupported } from '../../src/shared/subtitles'

describe('台词书写系统判定', () => {
  it('识别中文、英文、日文、韩文', () => {
    expect(scriptLanguage('你好呀，维尔汀。')).toBe('zh')
    expect(scriptLanguage('Hello there, how are you?')).toBe('en')
    expect(scriptLanguage('こんにちは、元気ですか')).toBe('ja')
    expect(scriptLanguage('안녕하세요')).toBe('ko')
    expect(scriptLanguage('……！')).toBe('none')
  })

  it('中英混排时按多数派判定', () => {
    expect(scriptLanguage('OK，维尔汀，我们走吧')).toBe('zh')
    expect(scriptLanguage('Good night, 晚安各位')).toBe('en')
  })

  it('英文音色模型不能接中文台词', () => {
    expect(speechLanguageSupported('en', '你好呀，维尔汀。')).toBe(false)
    expect(speechLanguageSupported('en', 'Hello there.')).toBe(true)
  })

  it('中文模型可以念英文，日文模型不能念中文', () => {
    expect(speechLanguageSupported('zh', 'Hello there.')).toBe(true)
    expect(speechLanguageSupported('zh', '你好。')).toBe(true)
    expect(speechLanguageSupported('ja', '你好。')).toBe(false)
    expect(speechLanguageSupported('ja', 'こんにちは')).toBe(true)
  })

  it('纯标点不拦截', () => {
    expect(speechLanguageSupported('en', '……')).toBe(true)
    expect(speechLanguageSupported('en', '')).toBe(true)
  })

  it('语言代码有可读名称', () => {
    expect(speechLanguageLabel('en')).toBe('英语')
    expect(speechLanguageLabel('zh-CN')).toBe('中文')
    expect(speechLanguageLabel('yue')).toBe('粤语')
    expect(speechLanguageLabel('xx')).toBe(null)
  })
})
