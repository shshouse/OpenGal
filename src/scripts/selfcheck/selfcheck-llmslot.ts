import assert from 'node:assert'
import { resolveSlotConfig } from '../../shared/llmSlot.ts'

const main = { baseURL: 'https://main.example.com', apiKey: 'k1', modelName: 'main-model' }
const sub = { id: 'p1', label: 'Sub', baseURL: 'https://sub.example.com', apiKey: 'k2', modelName: 'sub-model' }

assert.deepStrictEqual(resolveSlotConfig(main, [sub], 'p1', 'main'), { config: main, isFallback: true })
assert.deepStrictEqual(resolveSlotConfig(main, [sub], undefined, 'sub'), { config: main, isFallback: true })
assert.deepStrictEqual(resolveSlotConfig(main, [sub], '', 'sub'), { config: main, isFallback: true })

const hit = resolveSlotConfig(main, [sub], 'p1', 'sub')
assert.strictEqual(hit.config.modelName, 'sub-model')
assert.strictEqual(hit.isFallback, false)

assert.deepStrictEqual(resolveSlotConfig(main, [sub], 'deleted-id', 'sub'), { config: main, isFallback: true })
assert.deepStrictEqual(resolveSlotConfig(main, undefined, 'p1', 'sub'), { config: main, isFallback: true })

console.log('selfcheck-llmslot: all pass')
