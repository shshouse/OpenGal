import type { MemoryFact, MemoryStory } from '@shared/types'

export function summarizeMemories(facts: MemoryFact[], stories: MemoryStory[], now = Date.now()) {
  const activeFacts = facts.filter((fact) => fact.status === 'active')
  const activeStories = stories.filter((story) => story.status === 'active')
  const entityCounts = { user: 0, character: 0, relationship: 0 }
  for (const fact of activeFacts) entityCounts[fact.entity] += 1

  const pendingPromises = activeStories
    .filter((story) => story.kind === 'promise' && !story.fulfilled)
    .filter((story) => !story.due_at || new Date(story.due_at).getTime() >= now)
    .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
  const milestones = activeStories
    .filter((story) => story.kind === 'milestone')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 3)

  return {
    activeFacts: activeFacts.length,
    activeStories: activeStories.length,
    entityCounts,
    pendingPromises,
    milestones,
  }
}
