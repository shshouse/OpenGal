import { describe, expect, it } from 'vitest'
import { scoreMemory, scoreParts } from '../../src/main/services/memory/score'
import type { Memory } from '../../src/main/services/memory/model'

const NOW = Date.UTC(2026, 10, 9, 12, 0)

function memory(over: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    roleId: 'c1',
    kind: 'fact',
    episodeKind: null,
    text: '用户的猫叫年糕',
    entity: 'user',
    subject: '用户',
    attribute: '猫的名字',
    value: '年糕',
    negated: false,
    importance: 5,
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
    ...over,
  }
}

describe('记忆打分', () => {
  it('相关性权重高于重要度：低重要度的强相关记忆排在前面', () => {
    const relevant = scoreMemory(memory({ id: 'a', importance: 4 }), 0.9, NOW)
    const important = scoreMemory(memory({ id: 'b', importance: 10 }), 0.05, NOW)
    expect(relevant).toBeGreaterThan(important)
  })

  it('同等相关时重要度更高的胜出', () => {
    const light = scoreMemory(memory({ id: 'a', importance: 3 }), 0.5, NOW)
    const heavy = scoreMemory(memory({ id: 'b', importance: 9 }), 0.5, NOW)
    expect(heavy).toBeGreaterThan(light)
  })

  it('推断来源比用户原话低', () => {
    const stated = scoreMemory(memory({ source: 'user_statement' }), 0.6, NOW)
    const inferred = scoreMemory(memory({ source: 'llm_inferred' }), 0.6, NOW)
    expect(inferred).toBeLessThan(stated)
  })

  it('被杀过号的事实新鲜度归零', () => {
    const fresh = scoreMemory(memory(), 0.6, NOW)
    const stale = scoreMemory(memory({ confirmedAt: NOW - 400 * 86_400_000 }), 0.6, NOW)
    expect(stale).toBeLessThan(fresh)
  })

  it('临近到期与反复印证各自加分', () => {
    const base = scoreMemory(memory(), 0.6, NOW)
    const withDue = scoreMemory(memory({ kind: 'episode', episodeKind: 'promise', dueAt: new Date(NOW + 2 * 86_400_000).toISOString() }), 0.6, NOW)
    const reinforced = scoreMemory(memory({ evidence: { reinforce: 3, negate: 0 } }), 0.6, NOW)
    expect(withDue).toBeGreaterThan(base * 0.8)
    expect(reinforced).toBeGreaterThan(base)
  })

  it('分数组成可以单独解释', () => {
    const parts = scoreParts(memory({ importance: 10 }), 1, NOW)
    expect(parts.relevance).toBe(1)
    expect(parts.importance).toBe(1)
    expect(parts.total).toBeGreaterThan(0.9)
    expect(parts.total).toBeLessThanOrEqual(1)
  })
})
