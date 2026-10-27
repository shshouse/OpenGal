import { run } from './core'
import type { MemoryRow, FactRow, StoryRow } from './types'

export function insertMemoryRowRaw(characterId: string, row: MemoryRow): void {
  run(
      `INSERT OR REPLACE INTO memories(id, character_id, kind, text, entity, subject, attribute, object, polarity, confidence, source, state, importance, happened_at, created_at, confirmed_at, source_from, source_to, supersedes, pinned, embedding, valid_from, invalid_at, due_at, frozen_at, evidence)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        characterId,
        row.kind,
        row.text,
        row.entity ?? 'user',
        row.subject ?? null,
        row.attribute ?? null,
        row.object ?? null,
        row.polarity ?? null,
        row.confidence ?? 0.8,
        row.source ?? 'llm_inferred',
        row.state,
        row.importance,
        row.happened_at,
        row.created_at,
        row.confirmed_at ?? null,
        row.source_from,
        row.source_to,
        row.supersedes,
        row.pinned,
        row.embedding,
        row.valid_from ?? null,
        row.invalid_at ?? null,
        row.due_at ?? null,
        row.frozen_at ?? null,
        row.evidence ?? null,
      ]
    )
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString()
}

export function isoToMs(iso: string, fallback = Date.now()): number {
  const value = Date.parse(iso)
  return Number.isFinite(value) ? value : fallback
}

function evidenceRange(raw: string | null | undefined): { fromTs?: number; toTs?: number } {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as { fromTs?: number; toTs?: number }
  } catch {
    return {}
  }
}

export function factRowToMemory(characterId: string, f: FactRow): MemoryRow {
  const range = evidenceRange(f.source_evidence)
  return {
    id: f.id,
    character_id: characterId,
    kind: 'fact',
    text: f.text,
    entity: f.entity,
    subject: f.subject ?? null,
    attribute: f.attribute ?? null,
    object: f.object ?? null,
    polarity: f.polarity ?? 1,
    confidence: f.confidence,
    source: f.source,
    state: f.status,
    importance: f.importance,
    happened_at: null,
    created_at: isoToMs(f.created_at),
    confirmed_at: isoToMs(f.last_confirmed_at),
    source_from: range.fromTs ?? null,
    source_to: range.toTs ?? null,
    supersedes: null,
    pinned: f.protected_ === 1 || f.frozen_at ? 1 : 0,
    embedding: f.embedding,
    valid_from: f.valid_from ?? null,
    invalid_at: f.invalid_at ?? f.valid_until ?? null,
    due_at: null,
    frozen_at: f.frozen_at,
    evidence: f.source_evidence,
  }
}

export function memoryToFactRow(r: MemoryRow): FactRow {
  const pinned = r.pinned === 1
  return {
    id: r.id,
    character_id: r.character_id,
    text: r.text,
    entity: (r.entity ?? 'user') as FactRow['entity'],
    subject: r.subject ?? null,
    attribute: r.attribute ?? null,
    object: r.object ?? null,
    polarity: r.polarity ?? 1,
    importance: r.importance,
    confidence: r.confidence ?? 0.8,
    source: r.source ?? 'llm_inferred',
    created_at: msToIso(r.created_at),
    last_confirmed_at: msToIso(r.confirmed_at ?? r.created_at),
    status: r.state,
    evidence_reinforce: 0,
    evidence_negate: 0,
    protected_: pinned ? 1 : 0,
    valid_until: r.invalid_at ?? null,
    frozen_at: r.frozen_at ?? (pinned ? msToIso(r.confirmed_at ?? r.created_at) : null),
    embedding: r.embedding,
    source_evidence:
      r.evidence ??
      (r.source_from !== null && r.source_to !== null
        ? JSON.stringify({ fromTs: r.source_from, toTs: r.source_to })
        : null),
    valid_from: r.valid_from ?? null,
    invalid_at: r.invalid_at ?? null,
    superseded_by: null,
  }
}

export function storyRowToMemory(characterId: string, s: StoryRow): MemoryRow {
  const range = evidenceRange(s.source_evidence)
  return {
    id: s.id,
    character_id: characterId,
    kind: s.kind,
    text: s.text,
    state: s.status === 'active' ? (s.fulfilled === 1 ? 'fulfilled' : 'active') : 'archived',
    importance: s.importance,
    happened_at: isoToMs(s.occurred_at),
    created_at: isoToMs(s.created_at),
    source_from: range.fromTs ?? null,
    source_to: range.toTs ?? null,
    supersedes: null,
    pinned: 0,
    embedding: null,
    due_at: s.due_at,
    frozen_at: null,
    evidence: s.source_evidence,
  }
}

export function memoryToStoryRow(r: MemoryRow): StoryRow {
  const inactive = r.state === 'archived' || r.state === 'cancelled' || r.state === 'superseded'
  return {
    id: r.id,
    character_id: r.character_id,
    kind: r.kind,
    text: r.text,
    occurred_at: msToIso(r.happened_at ?? r.created_at),
    due_at: r.due_at ?? null,
    fulfilled: r.state === 'fulfilled' ? 1 : 0,
    importance: r.importance,
    status: inactive ? 'archived' : 'active',
    created_at: msToIso(r.created_at),
    source_evidence:
      r.evidence ??
      (r.source_from !== null && r.source_to !== null
        ? JSON.stringify({ fromTs: r.source_from, toTs: r.source_to })
        : null),
  }
}
