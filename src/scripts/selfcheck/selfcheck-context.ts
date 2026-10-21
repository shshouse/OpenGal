import assert from 'node:assert'
import { packContext, type ContextItem } from '../../renderer/src/features/pipeline/contextAssembler.ts'
import type { ChatMessage } from '../../shared/types.ts'

const text = (content: string, contextTag?: ChatMessage['contextTag']): ChatMessage => ({
  role: 'system',
  content,
  ...(contextTag ? { contextTag } : {}),
})
const estimate = (message: ChatMessage): number => String(message.content).length

// 顺序：system → env → 历史（中间夹一条摘要）→ 本轮意图
const items: ContextItem[] = [
  { id: 'system', message: text('S'.repeat(100)), priority: 1000 },
  { id: 'env', message: text('E'.repeat(20), 'env'), priority: 800 },
  { id: 'h0', message: text('a'.repeat(20)), priority: 100 },
  { id: 'summary', message: text('M'.repeat(50), 'summary'), priority: 700 },
  { id: 'h1', message: text('b'.repeat(20)), priority: 101 },
  { id: 'intent', message: text('I'.repeat(20), 'intent'), priority: 950 },
]

// 1) 预算充足：全部保留，顺序不变
const big = packContext(items, 10000, estimate)
assert.strictEqual(big.messages.length, items.length, '大预算应保留全部段')
assert.deepStrictEqual(
  big.messages.map((m) => String(m.content)[0]),
  ['S', 'E', 'a', 'M', 'b', 'I'],
  '大预算应保持原始顺序',
)
assert.strictEqual(big.droppedIds.length, 0)
assert.strictEqual(big.overflow, false)

// 2) 中等预算：摘要优先于旧原文；最新一条原文保住，最旧一条被丢
const mid = packContext(items, 220, estimate)
assert.ok(mid.keptIds.includes('summary'), '摘要应优先于历史原文')
assert.ok(mid.keptIds.includes('h1'), '最新原文应保留')
assert.ok(!mid.keptIds.includes('h0'), '最旧原文应先被丢弃')
assert.deepStrictEqual(
  mid.messages.map((m) => String(m.content)[0]),
  ['S', 'E', 'M', 'b', 'I'],
  '丢弃后仍应保持原始顺序',
)

// 3) 预算极紧：system 与 intent 必留，标记 overflow，env 被丢
const tiny = packContext(items, 50, estimate)
assert.deepStrictEqual(tiny.keptIds, ['system', 'intent'], '仅必需段保留')
assert.strictEqual(tiny.overflow, true, '必需段超预算应标记 overflow')

// 4) 没有摘要时：历史按新近度填充预算
const noSummary = items.filter((i) => i.id !== 'summary').map((i) =>
  i.id.startsWith('h') ? { ...i, priority: 100 + Number(i.id.slice(1)) } : i,
)
const fill = packContext(noSummary, 160, estimate)
assert.ok(fill.keptIds.includes('h1'), '无摘要时应优先保留最新原文')
assert.ok(!fill.keptIds.includes('h0'), '无摘要时最旧原文仍先被丢弃')

console.log('selfcheck-context: all pass')
