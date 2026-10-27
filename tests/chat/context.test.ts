import { describe, expect, it } from 'vitest'
import { packContext, type ContextItem } from '@/features/pipeline/contextAssembler'
import type { ChatMessage } from '@shared/types'

const text = (content: string, contextTag?: ChatMessage['contextTag']): ChatMessage => ({
  role: 'system',
  content,
  ...(contextTag ? { contextTag } : {}),
})
const estimate = (message: ChatMessage): number => String(message.content).length

const items: ContextItem[] = [
  { id: 'system', message: text('S'.repeat(100)), priority: 1000 },
  { id: 'env', message: text('E'.repeat(20), 'env'), priority: 800 },
  { id: 'h0', message: text('a'.repeat(20)), priority: 100 },
  { id: 'summary', message: text('M'.repeat(50), 'summary'), priority: 700 },
  { id: 'h1', message: text('b'.repeat(20)), priority: 101 },
  { id: 'intent', message: text('I'.repeat(20), 'intent'), priority: 950 },
]

describe('packContext', () => {
  it('预算充足时保留全部并保持原始顺序', () => {
    const packed = packContext(items, 10000, estimate)
    expect(packed.messages).toHaveLength(items.length)
    expect(packed.messages.map((m) => String(m.content)[0])).toEqual(['S', 'E', 'a', 'M', 'b', 'I'])
    expect(packed.droppedIds).toEqual([])
    expect(packed.overflow).toBe(false)
  })

  it('中等预算下摘要优先于旧原文，最新原文保留', () => {
    const packed = packContext(items, 220, estimate)
    expect(packed.keptIds).toContain('summary')
    expect(packed.keptIds).toContain('h1')
    expect(packed.keptIds).not.toContain('h0')
    expect(packed.messages.map((m) => String(m.content)[0])).toEqual(['S', 'E', 'M', 'b', 'I'])
  })

  it('极紧预算只保留 system 与 intent，并标记 overflow', () => {
    const packed = packContext(items, 50, estimate)
    expect(packed.keptIds).toEqual(['system', 'intent'])
    expect(packed.overflow).toBe(true)
  })

  it('没有摘要时按新近度填充预算', () => {
    const noSummary = items
      .filter((item) => item.id !== 'summary')
      .map((item) => (item.id.startsWith('h') ? { ...item, priority: 100 + Number(item.id.slice(1)) } : item))
    const packed = packContext(noSummary, 160, estimate)
    expect(packed.keptIds).toContain('h1')
    expect(packed.keptIds).not.toContain('h0')
  })
})
