import assert from 'node:assert'
import { normalizeOpenAIUsage } from '../src/main/services/llm/usage.ts'

// 正常三值
assert.deepStrictEqual(
  normalizeOpenAIUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
  { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
)
// total 缺失时两值相加
assert.deepStrictEqual(
  normalizeOpenAIUsage({ prompt_tokens: 10, completion_tokens: 5 }),
  { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
)
// 字段缺失返回 null，不估算
assert.strictEqual(normalizeOpenAIUsage(undefined), null)
assert.strictEqual(normalizeOpenAIUsage({ prompt_tokens: 10 }), null)
assert.strictEqual(normalizeOpenAIUsage({ prompt_tokens: '10', completion_tokens: 5 }), null)

console.log('selfcheck-usage: all pass')
