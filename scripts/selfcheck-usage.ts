import assert from 'node:assert'
import { normalizeOpenAIUsage } from '../src/main/services/llm/usage.ts'

assert.deepStrictEqual(
  normalizeOpenAIUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
  { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
)
assert.deepStrictEqual(
  normalizeOpenAIUsage({ prompt_tokens: 10, completion_tokens: 5 }),
  { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
)
assert.strictEqual(normalizeOpenAIUsage(undefined), null)
assert.strictEqual(normalizeOpenAIUsage({ prompt_tokens: 10 }), null)
assert.strictEqual(normalizeOpenAIUsage({ prompt_tokens: '10', completion_tokens: 5 }), null)

console.log('selfcheck-usage: all pass')
