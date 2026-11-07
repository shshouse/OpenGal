import { describe, expect, it } from 'vitest'
import type { MemoryFact, MemoryStory } from '../../src/shared/types'
import { summarizeMemories } from '../../src/renderer/src/components/dashboard/memorySummary'

function fact(entity: MemoryFact['entity'], status: MemoryFact['status'] = 'active'): MemoryFact {
  return { id: entity, text: entity, entity, status } as MemoryFact
}
function story(kind: MemoryStory['kind'], overrides: Partial<MemoryStory> = {}): MemoryStory {
  return {
    id: `${kind}-${Math.random()}`,
    kind,
    text: kind,
    occurred_at: '2026-01-01T00:00:00.000Z',
    due_at: null,
    fulfilled: false,
    importance: 5,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('memory summary', () => {
  it('只统计活跃记忆并按实体分组', () => {
    const result = summarizeMemories([
      fact('user'), fact('user'), fact('character'), fact('relationship'), fact('user', 'archived'),
    ], [])

    expect(result.activeFacts).toBe(4)
    expect(result.entityCounts).toEqual({ user: 2, character: 1, relationship: 1 })
    expect(result.activeStories).toBe(0)
  })

  it('排除已完成和已过期的约定，保留最近里程碑', () => {
    const now = new Date('2026-10-30T00:00:00.000Z').getTime()
    const result = summarizeMemories([], [
      story('promise', { id: 'expired', due_at: '2026-10-01T00:00:00.000Z' }),
      story('promise', { id: 'future', due_at: '2026-11-01T00:00:00.000Z' }),
      story('promise', { id: 'done', fulfilled: true }),
      story('milestone', { id: 'old', occurred_at: '2026-01-01T00:00:00.000Z' }),
      story('milestone', { id: 'new', occurred_at: '2026-02-01T00:00:00.000Z' }),
      story('event', { id: 'archived', status: 'archived' }),
    ], now)

    expect(result.activeStories).toBe(5)
    expect(result.pendingPromises.map((item) => item.id)).toEqual(['future'])
    expect(result.milestones.map((item) => item.id)).toEqual(['new', 'old'])
  })
})
