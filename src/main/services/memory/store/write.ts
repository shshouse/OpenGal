import { randomUUID } from 'node:crypto'
import type { MemoryApplyPayload, MemoryCandidateFact, MemoryCandidateStory } from '@shared/types'
import { memoryDbReady } from '../db/core'
import {
  isPositive,
  similarity,
  slotOf,
  type Memory,
  type MemoryEntity,
  type MemoryEvidence,
  type MemorySource,
} from '../model/model'
import {
  deleteMemory,
  insertMemory,
  listMemories,
  reinforceMemory,
  setMemoryFrozen,
  setMemoryState,
} from './store'
import { listMessageIdsInRange } from './memories'
import { pruneSummaries } from './summaries'

const MAX_ACTIVE_MEMORIES = 2000

let lastStamp = 0

function nowMs(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1)
  return lastStamp
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

function sourceOf(candidate: MemoryCandidateFact, confidence: number): MemorySource {
  if (candidate.attributed_to === 'user') return 'user_statement'
  if (candidate.attributed_to === 'character') return 'character_statement'
  if (candidate.attributed_to === 'inferred') return 'llm_inferred'
  return confidence >= 1 ? 'user_statement' : 'llm_inferred'
}

function toMemory(roleId: string, candidate: MemoryCandidateFact, at: number): Memory {
  const source = sourceOf(candidate, candidate.confidence)
  return {
    id: newId('f'),
    roleId,
    kind: 'fact',
    episodeKind: null,
    text: candidate.text.trim(),
    entity: candidate.entity,
    subject: candidate.subject?.trim() || null,
    attribute: candidate.attribute?.trim() || null,
    value: candidate.object?.trim() || null,
    negated: candidate.polarity === false,
    importance: Math.min(10, Math.max(1, Math.round(candidate.importance))),
    source,
    state: 'active',
    happenedAt: null,
    dueAt: null,
    validFrom: new Date(at).toISOString(),
    invalidAt: candidate.valid_until ?? null,
    confirmedAt: at,
    evidence: { reinforce: 0, negate: 0 },
    pinned: Boolean(candidate.frozen),
    frozen: Boolean(candidate.frozen),
    embedding: null,
    createdAt: at,
  }
}

export interface ApplyResult {
  insertedFacts: number
  refreshedFacts: number
  insertedStories: number
}

interface ApplyContext {
  roleId: string
  existing: Memory[]
  at: number
  evidence?: MemoryEvidence
  result: ApplyResult
}

function applyFactCandidate(context: ApplyContext, candidate: MemoryCandidateFact): void {
  const { roleId, existing, at, evidence, result } = context
  const entry = toMemory(roleId, candidate, at)
  if (evidence) entry.evidence = { ...entry.evidence, ...evidence }

  const repeated = existing.find(
    (memory) =>
      memory.kind === 'fact' &&
      memory.state === 'active' &&
      slotOf(memory) === slotOf(entry) &&
      isPositive({ polarity: !memory.negated }) === isPositive({ polarity: !entry.negated }) &&
      similarity(memory.text, entry.text) >= 0.9,
  )
  if (repeated) {
    reinforceMemory(repeated.id, at, roleId)
    result.refreshedFacts++
    return
  }
  insertMemory(roleId, entry, 'llm')
  existing.push(entry)
  result.insertedFacts++
}

function applyEpisodeCandidate(
  roleId: string,
  candidate: MemoryCandidateStory,
  at: number,
  evidence: MemoryEvidence | undefined,
): void {
  insertMemory(
    roleId,
    {
      id: newId('s'),
      roleId,
      kind: 'episode',
      episodeKind: candidate.kind,
      text: candidate.text.trim(),
      entity: 'relationship',
      subject: null,
      attribute: null,
      value: null,
      negated: false,
      importance: Math.min(10, Math.max(1, Math.round(candidate.importance))),
      source: 'llm_inferred',
      state: 'active',
      happenedAt: at,
      dueAt: candidate.due_at ?? null,
      validFrom: new Date(at).toISOString(),
      invalidAt: null,
      confirmedAt: at,
      evidence: evidence ? { ...evidence } : { reinforce: 0, negate: 0 },
      pinned: false,
      frozen: false,
      embedding: null,
      createdAt: at,
    },
    'llm',
  )
}

export async function applyCandidates(
  roleId: string,
  payload: MemoryApplyPayload,
): Promise<ApplyResult> {
  await memoryDbReady()
  const existing = listMemories(roleId)
  const result: ApplyResult = { insertedFacts: 0, refreshedFacts: 0, insertedStories: 0 }
  const at = nowMs()
  const evidence: MemoryEvidence | undefined = payload.evidence
    ? {
        fromTs: payload.evidence.fromTs,
        toTs: payload.evidence.toTs,
        messageIds: listMessageIdsInRange(roleId, payload.evidence.fromTs, payload.evidence.toTs),
        reinforce: 0,
        negate: 0,
      }
    : undefined

  const context: ApplyContext = { roleId, existing, at, evidence, result }
  for (const candidate of (payload.facts ?? []).filter((item) => item.text?.trim())) {
    applyFactCandidate(context, candidate)
  }

  for (const candidate of (payload.stories ?? []).filter((item) => item.text?.trim())) {
    applyEpisodeCandidate(roleId, candidate, at, evidence)
    result.insertedStories++
  }

  return result
}

export async function manualAddFact(
  roleId: string,
  text: string,
  entity: MemoryEntity = 'user',
): Promise<Memory> {
  await memoryDbReady()
  const at = nowMs()
  const entry: Memory = {
    id: newId('f'),
    roleId,
    kind: 'fact',
    episodeKind: null,
    text,
    entity,
    subject: null,
    attribute: null,
    value: null,
    negated: false,
    importance: 10,
    source: 'manual',
    state: 'active',
    happenedAt: null,
    dueAt: null,
    validFrom: new Date(at).toISOString(),
    invalidAt: null,
    confirmedAt: at,
    evidence: { reinforce: 0, negate: 0 },
    pinned: true,
    frozen: false,
    embedding: null,
    createdAt: at,
  }
  insertMemory(roleId, entry, 'user')
  return entry
}

export async function pruneOverflow(
  roleId: string,
  limit = MAX_ACTIVE_MEMORIES,
): Promise<{ archived: number }> {
  await memoryDbReady()
  pruneSummaries(roleId)
  const active = listMemories(roleId).filter((memory) => memory.state === 'active')
  if (active.length <= limit) return { archived: 0 }
  const pinned = active.filter((memory) => memory.pinned)
  const rest = active
    .filter((memory) => !memory.pinned)
    .sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt)
  const room = Math.max(0, limit - pinned.length)
  const drop = rest.slice(room)
  for (const memory of drop) setMemoryState(memory.id, 'archived', roleId)
  return { archived: drop.length }
}

export async function freezeFact(roleId: string, factId: string): Promise<boolean> {
  await memoryDbReady()
  return setMemoryFrozen(factId, new Date(nowMs()).toISOString(), roleId) > 0
}

export async function unfreezeFact(roleId: string, factId: string): Promise<boolean> {
  await memoryDbReady()
  return setMemoryFrozen(factId, null, roleId) > 0
}

export async function deleteFact(roleId: string, factId: string): Promise<boolean> {
  await memoryDbReady()
  return deleteMemory(factId, roleId) > 0
}
