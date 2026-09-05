import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  adjudicateFact,
  applyCandidates,
  buildMemoryBlock,
  clearMemory,
  initMemoryStore,
  loadFacts,
  normalizeText,
  textSimilarity,
} from '../src/main/services/memoryStore.ts'

assert.strictEqual(normalizeText('你好， 世界！'), '你好世界')
assert.strictEqual(textSimilarity('用户的生日是6月12日', '用户的生日是 6 月 12 日'), 1)
assert.ok(textSimilarity('用户喜欢猫', '用户讨厌下雨') < 0.6)

const active = [
  {
    id: 'f1',
    text: '用户的生日是6月12日',
    entity: 'user' as const,
    importance: 10,
    confidence: 1,
    source: 'user_statement' as const,
    created_at: '',
    last_confirmed_at: '',
    status: 'active' as const,
    evidence: { reinforce: 0, negate: 0 },
  },
]

const refresh = adjudicateFact(
  { text: '用户的生日是6月12日，记得提醒', entity: 'user', importance: 10, confidence: 1, reason: 'r' },
  active,
)
assert.strictEqual(refresh.action, 'refresh')

const insert = adjudicateFact(
  { text: '用户在准备CP考试', entity: 'user', importance: 6, confidence: 0.5, reason: 'r' },
  active,
)
assert.strictEqual(insert.action, 'insert')

const root = path.join(os.tmpdir(), `og-memtest-${Date.now()}`)
initMemoryStore(root, {
  factBudgetChars: 4000,
  storyBudgetChars: 3000,
  injectCharCap: 900,
  batchTurns: 8,
  idleMinutes: 5,
  fallbackHours: 12,
  windowBatchTurns: 10,
})

const r1 = await applyCandidates('c1', {
  facts: [{ text: '用户的生日是6月12日', entity: 'user', importance: 10, confidence: 1, reason: '明确陈述' }],
  stories: [
    { kind: 'promise', text: '寒假一起看樱花', importance: 8, reason: '明确约定', due_at: '2027-01-20T00:00:00Z' },
    { kind: 'event', text: '考试挂科那晚陪聊到十二点', importance: 7, reason: '共同经历' },
  ],
})
assert.strictEqual(r1.insertedFacts, 1)
assert.strictEqual(r1.insertedStories, 2)

const block = buildMemoryBlock(loadFacts('c1'), JSON.parse(fs.readFileSync(path.join(root, 'memory', 'c1', 'story.json'), 'utf-8')))
assert.ok(block?.includes('生日'))
assert.ok(block?.includes('还没兑现'))
assert.ok(block?.includes('可能过时'))

initMemoryStore(root, { factBudgetChars: 30 })
clearMemory('c2')
const r2 = await applyCandidates('c2', {
  facts: [
    { text: '用户喜欢草莓蛋糕和抹茶味的一切甜点', entity: 'user', importance: 6, confidence: 1, reason: 'a' },
    { text: '用户讨厌香菜', entity: 'user', importance: 2, confidence: 1, reason: 'b' },
    { text: '用户在准备CP考试', entity: 'user', importance: 5, confidence: 1, reason: 'c' },
  ],
  stories: [],
})
assert.strictEqual(r2.insertedFacts, 3)
assert.strictEqual(r2.budgetRejected, 0)
const facts2 = loadFacts('c2')
assert.strictEqual(facts2.filter((f) => f.status === 'active').length, 2)
assert.strictEqual(facts2.filter((f) => f.status === 'archived').length, 1)
const archived = facts2.find((f) => f.status === 'archived')
assert.ok(archived?.text.includes('香菜'))

const r3 = await applyCandidates('c2', {
  facts: [{ text: '这一条记忆内容写得非常非常长，长到单独一条就超过了整个心记簿的预算上限，所以无论如何腾位都不可能被接受入库', entity: 'user', importance: 9, confidence: 1, reason: 'c' }],
  stories: [],
})
assert.strictEqual(r3.budgetRejected, 1)

fs.rmSync(root, { recursive: true, force: true })
console.log('selfcheck-memory: all pass')
