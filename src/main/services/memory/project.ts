import type { MemoryFact, MemoryStory } from '@shared/types'
import { relevanceScore } from './lexical'
import { assembleBlock } from './recall'
import { computeEmbeddingAsync, searchSimilarAsync } from './vector'
import { setMemoryEmbedding } from './store'
import type { EpisodeKind, Memory, MemoryEntity, MemorySource, MemoryState } from './model'

/**
 * 界面与旧接口只认 facts / stories 两种视图。视图是投影，不是存储模型：
 * 运行期读写一律走 Memory，这里只负责在边界处变形。
 */

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function factStatus(state: MemoryState): MemoryFact['status'] {
  if (state === 'superseded') return 'superseded'
  if (state === 'active') return 'active'
  return 'archived'
}

export function toFactView(memory: Memory): MemoryFact {
  return {
    id: memory.id,
    text: memory.text,
    entity: memory.entity,
    subject: memory.subject,
    attribute: memory.attribute,
    object: memory.value,
    polarity: !memory.negated,
    importance: memory.importance,
    confidence: memory.source === 'llm_inferred' ? 0.6 : 1,
    source: memory.source,
    created_at: iso(memory.createdAt),
    last_confirmed_at: iso(memory.confirmedAt),
    status: factStatus(memory.state),
    valid_from: memory.validFrom,
    invalid_at: memory.invalidAt,
    superseded_by: null,
    evidence: { reinforce: memory.evidence.reinforce, negate: memory.evidence.negate },
    protected: memory.pinned,
    valid_until: memory.invalidAt,
    frozen_at: memory.frozen ? iso(memory.confirmedAt) : null,
    embedding: memory.embedding,
  }
}

export function toStoryView(memory: Memory): MemoryStory {
  return {
    id: memory.id,
    kind: (memory.episodeKind ?? 'event') as MemoryStory['kind'],
    text: memory.text,
    occurred_at: iso(memory.happenedAt ?? memory.createdAt),
    due_at: memory.dueAt,
    fulfilled: memory.state === 'fulfilled',
    importance: memory.importance,
    status: memory.state === 'active' || memory.state === 'fulfilled' ? 'active' : 'archived',
    created_at: iso(memory.createdAt),
  }
}

export function factViewToMemory(roleId: string, fact: MemoryFact): Memory {
  const createdAt = Date.parse(fact.created_at) || Date.now()
  const confirmedAt = Date.parse(fact.last_confirmed_at) || createdAt
  return {
    id: fact.id,
    roleId,
    kind: 'fact',
    episodeKind: null,
    text: fact.text,
    entity: fact.entity as MemoryEntity,
    subject: fact.subject ?? null,
    attribute: fact.attribute ?? null,
    value: fact.object ?? null,
    negated: fact.polarity === false,
    importance: fact.importance,
    source: fact.source as MemorySource,
    state: fact.status,
    happenedAt: null,
    dueAt: null,
    validFrom: fact.valid_from ?? null,
    invalidAt: fact.invalid_at ?? fact.valid_until ?? null,
    confirmedAt,
    evidence: { reinforce: fact.evidence.reinforce, negate: fact.evidence.negate },
    pinned: Boolean(fact.protected),
    frozen: Boolean(fact.frozen_at),
    embedding: fact.embedding,
    createdAt,
  }
}

export function storyViewToMemory(roleId: string, story: MemoryStory): Memory {
  const createdAt = Date.parse(story.created_at) || Date.now()
  return {
    id: story.id,
    roleId,
    kind: 'episode',
    episodeKind: story.kind as EpisodeKind,
    text: story.text,
    entity: 'relationship',
    subject: null,
    attribute: null,
    value: null,
    negated: false,
    importance: story.importance,
    source: 'llm_inferred',
    state: story.fulfilled ? 'fulfilled' : story.status === 'active' ? 'active' : 'archived',
    happenedAt: Date.parse(story.occurred_at) || createdAt,
    dueAt: story.due_at,
    validFrom: null,
    invalidAt: null,
    confirmedAt: createdAt,
    evidence: { reinforce: 0, negate: 0 },
    pinned: false,
    frozen: false,
    embedding: null,
    createdAt,
  }
}

/** 旧签名：入参是 facts / stories 视图，内部仍走同一套装配。 */
export function buildMemoryBlock(
  facts: MemoryFact[],
  stories: MemoryStory[],
  charCap = 900,
  context?: string,
): string | null {
  const memories = [
    ...facts.map((fact) => factViewToMemory('', fact)),
    ...stories.map((story) => storyViewToMemory('', story)),
  ]
  return assembleBlock(memories, context ?? null, {
    charCap,
    relevance: context ? (memory) => relevanceScore(memory.text, context) : undefined,
  })
}

/** 旧签名：向量路径与关键词路径共用同一个装配函数，只是相关性来源不同。 */
export async function buildMemoryBlockVector(
  facts: MemoryFact[],
  stories: MemoryStory[],
  context: string,
  charCap: number,
): Promise<string | null> {
  const memories = [
    ...facts.map((fact) => factViewToMemory('', fact)),
    ...stories.map((story) => storyViewToMemory('', story)),
  ]
  return assembleWithVectors(memories, context, charCap)
}

export async function assembleWithVectors(
  memories: Memory[],
  context: string,
  charCap: number,
  onUsed?: (memory: Memory) => void,
): Promise<string | null> {
  const candidates = memories.filter((memory) => memory.kind === 'fact' && memory.state === 'active')
  const hits = new Map<string, number>()
  try {
    for (const memory of candidates) {
      if (memory.embedding) continue
      memory.embedding = await computeEmbeddingAsync(memory.text)
      setMemoryEmbedding(memory.id, memory.embedding)
    }
    const found = await searchSimilarAsync(candidates, context, 10, 0.2)
    for (const hit of found) hits.set(hit.id, hit.similarity)
  } catch {
    // 模型缺失或加载失败时退回词面相关性
  }
  return assembleBlock(memories, context, {
    charCap,
    relevance: (memory) => hits.get(memory.id) ?? relevanceScore(memory.text, context),
    onUsed,
  })
}
