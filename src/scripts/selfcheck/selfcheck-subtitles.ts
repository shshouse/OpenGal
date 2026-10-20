import assert from 'node:assert/strict'
import { languageCode, roleSpeechLanguage, subtitleText } from '../../shared/subtitles.ts'
import { buildSystemPrompt } from '../../shared/roleCard.ts'

assert.equal(languageCode('zh_CN'), 'zh')
assert.equal(languageCode('ja-JP'), 'ja')
assert.equal(languageCode('not a language'), '')
assert.equal(roleSpeechLanguage('ja-JP'), 'ja')
assert.throws(() => roleSpeechLanguage('fr'), /不支持/)
const segments = [{ id: 'first', text: 'こんにちは。', translation: '你好。' }, { id: 'second', text: '元気？' }]
assert.equal(subtitleText(segments, 'off'), 'こんにちは。元気？')
assert.equal(subtitleText(segments, 'translated'), '你好。元気？')
assert.equal(subtitleText(segments, 'bilingual'), 'こんにちは。元気？\n你好。元気？')
assert.equal(subtitleText([{ id: 'pending', text: '原文' }], 'bilingual'), '原文')
assert.equal(subtitleText([], 'translated'), '')
const prompt = buildSystemPrompt({
  id: 'test', name: 'test', language: 'ja', windowMode: 'pet', performance: { mode: 'auto' },
  persona: { description: 'test', personality: 'test' },
})
assert.ok(prompt.includes('台词必须使用 ja 语言'))
assert.ok(prompt.includes('只输出角色原文，不附翻译'))
console.log('subtitle selfcheck passed')
