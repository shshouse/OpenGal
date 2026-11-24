import { describe, expect, it } from 'vitest'
import { assembleBlock } from '../../src/main/services/memory/recall/recall'
import type { Memory } from '../../src/main/services/memory/model/model'

const NOW = Date.UTC(2026, 10, 24, 4, 0)

function memory(index: number): Memory {
  return {
    id: `m${index}`,
    roleId: 'c1',
    kind: 'fact',
    episodeKind: null,
    text: `用户提到第 ${index} 件日常小事，内容和别的不太一样${index % 7}`,
    entity: 'user',
    subject: '用户',
    attribute: `杂项${index}`,
    value: `v${index}`,
    negated: false,
    importance: (index % 10) + 1,
    source: 'user_statement',
    state: 'active',
    happenedAt: null,
    dueAt: null,
    validFrom: new Date(NOW).toISOString(),
    invalidAt: null,
    confirmedAt: NOW - 86_400_000,
    evidence: { reinforce: 0, negate: 0 },
    pinned: false,
    frozen: false,
    embedding: null,
    createdAt: NOW - 86_400_000,
  }
}

describe('记忆装配的规模上限', () => {
  // 早期实现每轮重算候选两两相似度（O(n³)），2000 条要十几分钟。
  // 这里只防退化，不作为性能基准；上限放得很宽，避免 CI 机器慢时误报。
  it('2000 条记忆仍能在一次对话的空闲预算内装配完', () => {
    const memories = Array.from({ length: 2000 }, (_, index) => memory(index))
    const started = Date.now()
    const block = assembleBlock(memories, null, { charCap: 8000, now: NOW })
    const cost = Date.now() - started

    expect(block).toBeTruthy()
    expect(cost).toBeLessThan(3000)
  })
})
