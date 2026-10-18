import assert from 'node:assert'
import { SpeechStreamParser, extractAssistantDisplayText } from '../../shared/roleCard.ts'

interface CheckItem {
  text: string
  emotion?: string
  action?: string
}

function collect(parts: string[]): CheckItem[] {
  const parser = new SpeechStreamParser()
  const items: CheckItem[] = []
  for (const part of parts) {
    for (const item of parser.feed(part)) {
      items.push({ text: item.text, emotion: item.emotion, action: item.action })
    }
  }
  for (const item of parser.flush()) {
    items.push({ text: item.text, emotion: item.emotion, action: item.action })
  }
  return items
}

const line = '你回来啦。<e:happy>今天想先听我弹琴，<e:shy>还是先吃饭？'
const expected = [
  { text: '你回来啦。', emotion: 'neutral', action: undefined },
  { text: '今天想先听我弹琴，', emotion: 'happy', action: undefined },
  { text: '还是先吃饭？', emotion: 'shy', action: undefined },
]

assert.deepStrictEqual(collect([line]), expected)

assert.deepStrictEqual(collect([...line]), expected)

assert.deepStrictEqual(collect(['你好<e:ha', 'ppy>世界。']), [
  { text: '你好', emotion: 'neutral', action: undefined },
  { text: '世界。', emotion: 'happy', action: undefined },
])

assert.deepStrictEqual(collect(['你好。今天怎么样？']), [
  { text: '你好。', emotion: 'neutral', action: undefined },
  { text: '今天怎么样？', emotion: 'neutral', action: undefined },
])

const action = collect(['<a:kaixin>你好。再见。'])
assert.strictEqual(action[0].action, 'kaixin')
assert.strictEqual(action[1].action, undefined)

const long = collect(['一'.repeat(40)])
assert.ok(long.length >= 2)
assert.ok(long[0].text.length <= 12)

assert.deepStrictEqual(collect(['<e:happy>']), [])

assert.deepStrictEqual(
  collect(['{"segments":[{"text":"你好","emotion":"happy"},{"text":"世界","emotion":"neutral"}]}']),
  [
    { text: '你好', emotion: 'happy', action: undefined },
    { text: '世界', emotion: 'neutral', action: undefined },
  ],
)

assert.deepStrictEqual(
  collect(['```json\n{"segments":[{"text":"你好","emotion":"happy"}]}\n```']),
  [{ text: '你好', emotion: 'happy', action: undefined }],
)

assert.strictEqual(
  extractAssistantDisplayText('<e:happy>你好。<e:neutral>再见。'),
  '你好。再见。',
)
assert.strictEqual(
  extractAssistantDisplayText('{"segments":[{"text":"你好"},{"text":"世界"}]}'),
  '你好世界',
)

console.log('selfcheck-speech-parser: all pass')
