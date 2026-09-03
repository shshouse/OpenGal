import assert from 'node:assert'
import { DialogueStreamParser } from '../src/shared/roleCard.ts'
import { splitChunk } from '../src/main/services/llm/chunkSplit.ts'

const p1 = new DialogueStreamParser()
assert.deepStrictEqual(p1.feed('{"text":"你好","emotion":"happy"}'), [
  { text: '你好', emotion: 'happy' },
])

const p2 = new DialogueStreamParser()
assert.deepStrictEqual(p2.feed('{"text":"我今'), [])
assert.deepStrictEqual(p2.feed('天很好"}'), [{ text: '我今天很好' }])

const p3 = new DialogueStreamParser()
assert.strictEqual(p3.feed('{"text":"a"}{"text":"b"}').length, 2)

const p4 = new DialogueStreamParser()
assert.deepStrictEqual(p4.feed('{"segments":[{"text":"第一句"},{"text":"第二句"}]}'), [
  { text: '第一句' },
  { text: '第二句' },
])

const p5 = new DialogueStreamParser()
const items5 = p5.feed('{"ok":true}{"text":"好"}')
assert.strictEqual(items5.length, 1)
assert.strictEqual(items5[0].text, '好')

const p6 = new DialogueStreamParser()
p6.feed('{"text":"未完')
assert.strictEqual(p6.flush().length, 0)

const p7 = new DialogueStreamParser()
assert.deepStrictEqual(p7.feed('{"text":"a}b"}'), [{ text: 'a}b' }])

const p8 = new DialogueStreamParser()
assert.deepStrictEqual(p8.feed('{"text":"前'), [])
assert.deepStrictEqual(p8.feed('半}半'), [])
assert.deepStrictEqual(p8.feed('段"}'), [{ text: '前半}半段' }])

const p9 = new DialogueStreamParser()
assert.deepStrictEqual(p9.feed('{"text":"a\\"b"}'), [{ text: 'a"b' }])

let s = { insideThinkBlock: false }
assert.deepStrictEqual(splitChunk('hello', s), { content: 'hello', reasoning: '' })
assert.strictEqual(s.insideThinkBlock, false)

s = { insideThinkBlock: false }
assert.deepStrictEqual(splitChunk('<think>推理</think>回答', s), {
  content: '回答',
  reasoning: '推理',
})

s = { insideThinkBlock: false }
assert.deepStrictEqual(splitChunk('前<think>推', s), { content: '前', reasoning: '推' })
assert.strictEqual(s.insideThinkBlock, true)
assert.deepStrictEqual(splitChunk('理中', s), { content: '', reasoning: '理中' })
assert.deepStrictEqual(splitChunk('完毕</think>后文', s), { content: '后文', reasoning: '完毕' })
assert.strictEqual(s.insideThinkBlock, false)

s = { insideThinkBlock: false }
assert.deepStrictEqual(splitChunk('a<thinking>x</thinking>b', s), { content: 'ab', reasoning: 'x' })

s = { insideThinkBlock: false }
assert.deepStrictEqual(splitChunk('<think>never closes', s), {
  content: '',
  reasoning: 'never closes',
})
assert.strictEqual(s.insideThinkBlock, true)

console.log('selfcheck-stream: all pass')
