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
  loadStories,
  normalizeText,
  textSimilarity,
} from '../../main/services/memoryStore.ts'
import {
  appendMessage,
  archiveMessagesRange,
  clearCharacterMessages,
  closeMemoryDb,
  getMeta,
  latestMessageId,
  listFacts,
  listSummaries,
  listUnarchivedMessages,
  memoryDbReady,
  addSummary,
  saveChatMessages,
} from '../../main/services/memoryDb.ts'
import { manualAddFact } from '../../main/services/memoryStore.ts'

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
const chatDir = path.join(root, 'chat_history')
fs.mkdirSync(chatDir, { recursive: true })
fs.writeFileSync(
  path.join(chatDir, 'c1.json'),
  JSON.stringify({
    version: 1,
    characterId: 'c1',
    messages: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '嗨，今天想做点什么？' },
    ],
  })
)

const legacyDir = path.join(root, 'memory', 'c1')
fs.mkdirSync(legacyDir, { recursive: true })
fs.writeFileSync(
  path.join(legacyDir, 'facts.json'),
  JSON.stringify([
    {
      id: 'legacy_f1',
      text: '用户的猫叫小饼',
      entity: 'user',
      importance: 7,
      confidence: 0.8,
      source: 'manual',
      created_at: '2025-01-01T00:00:00.000Z',
      last_confirmed_at: '2025-01-01T00:00:00.000Z',
      status: 'active',
      evidence: { reinforce: 2, negate: 0 },
    },
  ])
)
fs.writeFileSync(
  path.join(legacyDir, 'story.json'),
  JSON.stringify([
    {
      id: 'legacy_s1',
      kind: 'milestone',
      text: '第一次见面聊到凌晨',
      occurred_at: '2025-01-01T00:00:00.000Z',
      due_at: null,
      fulfilled: false,
      importance: 6,
      status: 'active',
      created_at: '2025-01-01T00:00:00.000Z',
    },
  ])
)

initMemoryStore(root, {
  factBudgetChars: 4000,
  storyBudgetChars: 3000,
  injectCharCap: 900,
  batchTurns: 8,
  idleMinutes: 5,
  fallbackHours: 12,
  windowBatchTurns: 10,
})
await memoryDbReady()
assert.strictEqual(listFacts('c1').length, 1)
const migratedFacts = await loadFacts('c1')
assert.strictEqual(migratedFacts.length, 1)
assert.strictEqual(migratedFacts[0].text, '用户的猫叫小饼')
assert.strictEqual(migratedFacts[0].protected, true)
assert.strictEqual(migratedFacts[0].evidence.reinforce, 2)
assert.strictEqual((await loadStories('c1')).length, 1)
assert.ok(getMeta('legacy_mem:c1'))
assert.ok(fs.existsSync(path.join(legacyDir, 'facts.json')))
assert.ok(fs.existsSync(path.join(legacyDir, 'story.json')))

const r1 = await applyCandidates('c1', {
  facts: [{ text: '用户的生日是6月12日', entity: 'user', importance: 10, confidence: 1, reason: '明确陈述' }],
  stories: [
    { kind: 'promise', text: '寒假一起看樱花', importance: 8, reason: '明确约定', due_at: '2027-01-20T00:00:00Z' },
    { kind: 'event', text: '考试挂科那晚陪聊到十二点', importance: 7, reason: '共同经历' },
  ],
})
assert.strictEqual(r1.insertedFacts, 1)
assert.strictEqual(r1.insertedStories, 2)

const block = buildMemoryBlock(await loadFacts('c1'), await loadStories('c1'))
assert.ok(block?.includes('生日'))
assert.ok(block?.includes('还没兑现'))
assert.ok(block?.includes('可能过时'))
const synced = listUnarchivedMessages('c1')
assert.strictEqual(synced.length, 2)
assert.strictEqual(synced[0].role, 'user')
// content 列存完整消息对象 JSON
assert.strictEqual((JSON.parse(synced[0].content) as { content: string }).content, '你好')

const dbPath = path.join(root, 'memory.db')
assert.ok(fs.existsSync(dbPath))
assert.ok(fs.statSync(dbPath).size > 0)
appendMessage({ character_id: 'c1', role: 'user', content: '"再来一条"', ts: Date.now(), archived: 0 })
assert.strictEqual(listUnarchivedMessages('c1').length, 3)

// 批量追加 + 锚点归档（原文保留）
saveChatMessages(
  'm1',
  Array.from({ length: 12 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant' }))
)
const m1Rows = listUnarchivedMessages('m1')
assert.strictEqual(m1Rows.length, 12)
const fromId = m1Rows[0].id as number
const toId = m1Rows[6].id as number
const archivedCount = archiveMessagesRange('m1', fromId, toId)
assert.strictEqual(archivedCount, 7)
assert.strictEqual(listUnarchivedMessages('m1').length, 5)
assert.strictEqual(latestMessageId('m1'), m1Rows[m1Rows.length - 1].id)

// 分段摘要（追加，不覆盖）
addSummary('m1', { start_ts: 1, end_ts: 2, text: '摘要v1', message_count: 7 })
addSummary('m1', { start_ts: 3, end_ts: 4, text: '摘要v2', message_count: 9 })
const sums = listSummaries('m1')
assert.strictEqual(sums.length, 2)
assert.strictEqual(sums[0].text, '摘要v1')
assert.strictEqual(sums[1].text, '摘要v2')

// 清空聊天
clearCharacterMessages('m1')
assert.strictEqual(listUnarchivedMessages('m1').length, 0)

initMemoryStore(root, { factBudgetChars: 30 })
await clearMemory('c2')
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
const facts2 = await loadFacts('c2')
assert.strictEqual(facts2.filter((f) => f.status === 'active').length, 2)
assert.strictEqual(facts2.filter((f) => f.status === 'archived').length, 1)
const archived = facts2.find((f) => f.status === 'archived')
assert.ok(archived?.text.includes('香菜'))

const r3 = await applyCandidates('c2', {
  facts: [{ text: '这一条记忆内容写得非常非常长，长到单独一条就超过了整个心记簿的预算上限，所以无论如何腾位都不可能被接受入库', entity: 'user', importance: 9, confidence: 1, reason: 'c' }],
  stories: [],
})
assert.strictEqual(r3.budgetRejected, 1)

// 清空记忆
await clearMemory('c2')
assert.strictEqual((await loadFacts('c2')).length, 0)

// protected（手动条目）豁免：judge 判 negate 也不被替换归档
initMemoryStore(root, { factBudgetChars: 30 })
const manual = await manualAddFact('c3', '用户养了一只猫')
assert.strictEqual(
  adjudicateFact(
    { text: '用户家里养了只猫', entity: 'user', importance: 9, confidence: 1, reason: 'r' },
    [manual],
  ).action,
  'judge'
)
const r4 = await applyCandidates(
  'c3',
  {
    facts: [
      { text: '用户家里养了只猫', entity: 'user', importance: 9, confidence: 1, reason: 'a' },
      { text: '用户喜欢骑摩托车兜风', entity: 'user', importance: 8, confidence: 1, reason: 'b' },
    ],
    stories: [],
  },
  async () => 'negates'
)
const facts4 = await loadFacts('c3')
assert.strictEqual(r4.refreshedFacts, 1)
assert.strictEqual(r4.insertedFacts, 1)
const manualAfter = facts4.find((f) => f.id === manual.id)
assert.ok(manualAfter && manualAfter.status === 'active')
assert.ok(!facts4.some((f) => f.text === '用户家里养了只猫'))

closeMemoryDb()
fs.rmSync(root, { recursive: true, force: true })
console.log('selfcheck-memory: all pass')
