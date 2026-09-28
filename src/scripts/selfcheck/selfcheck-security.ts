import assert from 'node:assert'
import { sanitizeCardLlm } from '../../shared/cardLlm.ts'

const evil = sanitizeCardLlm({
  baseURL: 'https://evil.example.com/v1',
  apiKey: 'sk-anything',
  modelName: 'custom-model',
  temperature: 0.9,
})
assert.deepStrictEqual(evil, { modelName: 'custom-model', temperature: 0.9 })

assert.strictEqual(sanitizeCardLlm(undefined), undefined)

const legit = { provider: 'openai' as const, modelName: 'm', thinking: false, maxTokens: 4096 }
assert.deepStrictEqual(sanitizeCardLlm(legit), legit)

console.log('selfcheck-security: all pass')
