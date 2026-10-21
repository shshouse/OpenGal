import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CorpusBuffer } from '../../renderer/src/features/memory/corpusBuffer.ts'
import {
  applyCandidates,
  deleteFact,
  initMemoryStore,
  loadFacts,
  manualAddFact,
  textSimilarity,
} from '../../main/services/memoryStore.ts'
import { closeMemoryDb, memoryDbReady } from '../../main/services/memoryDb.ts'
import {
  appendMessage,
  listUnarchivedMessages,
  replaceUnarchivedMessages,
} from '../../main/services/memoryDb.ts'

// ---- A：提取期间新进入的语料不得被清理 ----
const buf = new CorpusBuffer(1000)
buf.push({ characterId: 'c1', role: 'user', text: 'A', at: 1 })
const snap = buf.snapshot()
buf.push({ characterId: 'c1', role: 'user', text: 'B', at: 2 })
buf.dropExtracted('c1', snap.maxSeq)
const left = buf.entries()
assert.strictEqual(left.length, 1, 'A：提取期间新进入的 B 必须保留')
assert.strictEqual(left[0].text, 'B', 'A：保留的应是快照之后的条目')
console.log('A pass：快照前条目删除，快照后条目保留')

// ---- B：并发写不得丢失、不得复活 ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengal-memory-concurrency-'))
initMemoryStore(root, {
  factBudgetChars: 40000,
  storyBudgetChars: 30000,
  injectCharCap: 8000,
  batchTurns: 8,
  idleMinutes: 5,
  fallbackHours: 12,
})
await memoryDbReady()

// B1：两条并发手动添加
await Promise.all([
  manualAddFact('c2', '并发添加 A'),
  manualAddFact('c2', '并发添加 B'),
])
const b1 = await loadFacts('c2')
assert.strictEqual(b1.length, 2, `B1：并发手动添加不应丢失，实际 ${b1.length} 条`)
console.log('B1 pass：并发手动添加均保留')

// B2：删除期间提取完成，不得复活已删除的记忆
const F1 = '用户每天跑步五公里'
const F2 = '用户每周游泳三公里'
const sim = textSimilarity(F1, F2)
assert.ok(sim >= 0.35 && sim < 0.6, `B2 前置：候选必须走 judge 路径，实际相似度 ${sim.toFixed(3)}`)

const f1 = await manualAddFact('c3', F1)
let release!: () => void
const gate = new Promise<void>((resolve) => {
  release = resolve
})
const pending = applyCandidates(
  'c3',
  { facts: [{ text: F2, entity: 'user', importance: 6, confidence: 0.5, reason: 'test' }], stories: [] },
  async () => {
    await gate
    return 'reinforces'
  },
)
await new Promise((resolve) => setTimeout(resolve, 50))
await deleteFact('c3', f1.id)
release()
await pending
const b2 = await loadFacts('c3')
assert.ok(!b2.some((f) => f.id === f1.id), 'B2：删除的记忆不得被旧快照复活')
console.log('B2 pass：删除的记忆保持删除')

// B3：消息整表重写必须保留原 id 与时间戳（摘要锚点依赖 id 区间）
const OLD_TS = 111222333
appendMessage({
  character_id: 'c4',
  role: 'user',
  content: JSON.stringify({ role: 'user', content: '旧消息' }),
  ts: OLD_TS,
  archived: 0,
})
const before = listUnarchivedMessages('c4')
const oldId = before[0].id as number
replaceUnarchivedMessages('c4', [
  { id: oldId, character_id: 'c4', role: 'user', content: before[0].content, ts: before[0].ts, archived: 0 },
])
const after = listUnarchivedMessages('c4')
assert.strictEqual(after[0].id, oldId, 'B3：整表重写后消息 id 应保留')
assert.strictEqual(after[0].ts, OLD_TS, 'B3：整表重写后时间戳应保留')
console.log('B3 pass：整表重写保留 id 与时间戳')

closeMemoryDb()
fs.rmSync(root, { recursive: true, force: true })
console.log('selfcheck-memory-concurrency: all pass')
