import { db, rows, run, withTx, getMeta, setMeta } from './core'
import { factRowToMemory, insertMemoryRowRaw, isoToMs, memoryToFactRow, memoryToStoryRow, storyRowToMemory } from './memoryRows'
import {
  recordBulkChange,
  recordMemoryChange,
  recordMemoryFieldChange,
  type MemoryChangeActor,
} from './changelog'
import type { MemoryRow, FactRow, StoryRow, MessageRow } from './types'

function loadForChange(id: string): MemoryRow | null {
  const found = rows('SELECT * FROM memories WHERE id = ?', [id])
  return found.length > 0 ? (found[0] as unknown as MemoryRow) : null
}

export function insertMemoryRow(
  characterId: string,
  row: MemoryRow,
  actor: MemoryChangeActor = 'system',
): void {
  withTx(() => insertMemoryRowRaw(characterId, row, { actor }))
}

export function listMemoryRows(
  characterId: string,
  opts: { includeInactive?: boolean } = {},
): MemoryRow[] {
  const filter = opts.includeInactive ? '' : " AND state = 'active'"
  return rows(
    `SELECT * FROM memories WHERE character_id = ?${filter} ORDER BY created_at DESC, id`,
    [characterId]
  ) as unknown as MemoryRow[]
}

export function setMemoryStateRow(id: string, state: string): number {
  return withTx(() => {
    const before = loadForChange(id)
    const changed = Number(db!.prepare('UPDATE memories SET state = ? WHERE id = ?').run(state, id).changes)
    if (before && changed > 0) {
      recordMemoryFieldChange(before.character_id, id, 'state', before.state, state)
    }
    return changed
  })
}

export function setMemoryPinnedRow(id: string, pinned: boolean): number {
  return withTx(() => {
    const before = loadForChange(id)
    const changed = Number(db!.prepare('UPDATE memories SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id).changes)
    if (before && changed > 0) {
      recordMemoryFieldChange(before.character_id, id, 'pinned', String(before.pinned), pinned ? '1' : '0')
    }
    return changed
  })
}

export function setMemoryEmbeddingRow(id: string, embedding: string): number {
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(embedding, id).changes
  ))
}

export function confirmMemoryRow(id: string, ts: number): number {
  return withTx(() => {
    const before = loadForChange(id)
    const changed = Number(db!.prepare('UPDATE memories SET confirmed_at = ? WHERE id = ?').run(ts, id).changes)
    if (before && changed > 0) {
      recordMemoryFieldChange(
        before.character_id,
        id,
        'confirmed_at',
        before.confirmed_at === null || before.confirmed_at === undefined ? null : String(before.confirmed_at),
        String(ts),
      )
    }
    return changed
  })
}

export function deleteMemoryRow(id: string): number {
  return withTx(() => {
    const before = loadForChange(id)
    const changed = Number(db!.prepare('DELETE FROM memories WHERE id = ?').run(id).changes)
    if (before && changed > 0) {
      recordMemoryChange({
        memoryId: id,
        characterId: before.character_id,
        action: 'delete',
        oldValue: JSON.stringify(before),
        actor: 'user',
      })
    }
    return changed
  })
}

// 一条记忆的来源原话：优先用显式 messageIds，否则按记录的时间范围回查

export function clearCharacterMemories(characterId: string): void {
  withTx(() => {
    const before = Number(rows('SELECT COUNT(*) AS c FROM memories WHERE character_id = ?', [characterId])[0]?.c ?? 0)
    run('DELETE FROM memories WHERE character_id = ?', [characterId])
    recordBulkChange(characterId, 'clear', before, 'user')
  })
}

export function listFacts(characterId: string): FactRow[] {
  return listMemoryRows(characterId, { includeInactive: true })
    .filter((row) => row.kind === 'fact')
    .map(memoryToFactRow)
}

export function saveFacts(characterId: string, items: FactRow[]): void {
  withTx(() => {
    const before = Number(
      rows("SELECT COUNT(*) AS c FROM memories WHERE character_id = ? AND kind = 'fact'", [characterId])[0]?.c ?? 0
    )
    run("DELETE FROM memories WHERE character_id = ? AND kind = 'fact'", [characterId])
    for (const item of items) {
      insertMemoryRowRaw(characterId, factRowToMemory(characterId, item), { log: false })
    }
    recordBulkChange(characterId, 'rewrite_facts', before + items.length)
  })
}

export function insertFactRow(
  characterId: string,
  f: FactRow,
  actor: MemoryChangeActor = 'system',
): void {
  insertMemoryRow(characterId, factRowToMemory(characterId, f), actor)
}

export function getFactRow(id: string): FactRow | null {
  const found = rows('SELECT * FROM memories WHERE id = ?', [id])
  return found.length > 0 ? memoryToFactRow(found[0] as unknown as MemoryRow) : null
}

export function reinforceFactRow(id: string, ts: string): number {
  return confirmMemoryRow(id, isoToMs(ts))
}

export function negateFactRow(id: string): number {
  return setMemoryStateRow(id, 'archived')
}

export function setFactStatusRow(id: string, status: string): number {
  return setMemoryStateRow(id, status)
}

export function setFactFrozenRow(id: string, frozenAt: string | null): number {
  return withTx(() => {
    const before = loadForChange(id)
    const changed = Number(
      db!.prepare('UPDATE memories SET frozen_at = ?, pinned = ? WHERE id = ?')
        .run(frozenAt, frozenAt ? 1 : 0, id).changes
    )
    if (before && changed > 0) {
      recordMemoryFieldChange(before.character_id, id, 'frozen_at', before.frozen_at ?? null, frozenAt, 'user')
      recordMemoryFieldChange(before.character_id, id, 'pinned', String(before.pinned), frozenAt ? '1' : '0', 'user')
    }
    return changed
  })
}

export function setFactEmbeddingRow(id: string, embedding: string): number {
  return setMemoryEmbeddingRow(id, embedding)
}

export function deleteFactRow(id: string): number {
  return deleteMemoryRow(id)
}

export function listStories(characterId: string): StoryRow[] {
  return listMemoryRows(characterId, { includeInactive: true })
    .filter((row) => row.kind !== 'fact')
    .map(memoryToStoryRow)
}

export function saveStories(characterId: string, items: StoryRow[]): void {
  withTx(() => {
    const before = Number(
      rows("SELECT COUNT(*) AS c FROM memories WHERE character_id = ? AND kind != 'fact'", [characterId])[0]?.c ?? 0
    )
    run("DELETE FROM memories WHERE character_id = ? AND kind != 'fact'", [characterId])
    for (const item of items) {
      insertMemoryRowRaw(characterId, storyRowToMemory(characterId, item), { log: false })
    }
    recordBulkChange(characterId, 'rewrite_stories', before + items.length)
  })
}

export function insertStoryRow(
  characterId: string,
  s: StoryRow,
  actor: MemoryChangeActor = 'system',
): void {
  insertMemoryRow(characterId, storyRowToMemory(characterId, s), actor)
}

export function setStoryStatusRow(id: string, status: string): number {
  return setMemoryStateRow(id, status)
}

export function clearCharacterMemory(characterId: string): void {
  clearCharacterMemories(characterId)
}


export function getMemoryCursor(characterId: string): number {
  const raw = getMeta(`memory.cursor.${characterId}`)
  const parsed = raw ? Number(raw) : 0
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

export function setMemoryCursor(characterId: string, ts: number): void {
  setMeta(`memory.cursor.${characterId}`, String(Math.max(0, Math.floor(ts))))
}

// 第一次使用游标时不要回放整段历史：只回溯最近 N 条，避免升级后一次性重拉所有对话
export function isCursorInitialized(characterId: string): boolean {
  return getMeta(`memory.cursor.init.${characterId}`) === '1'
}

export function markCursorInitialized(characterId: string): void {
  setMeta(`memory.cursor.init.${characterId}`, '1')
}

export function bootstrapCursor(characterId: string, lookback: number): number {
  const found = rows(
    'SELECT ts FROM messages WHERE character_id = ? ORDER BY ts DESC LIMIT 1 OFFSET ?',
    [characterId, Math.max(0, lookback)],
  )
  const first = found[0]
  return first ? Number(first.ts) : 0
}

// 一批记忆对应的原文消息 id：用于回查“这条记忆是从哪句话来的”
export function listMessageIdsInRange(characterId: string, fromTs: number, toTs: number): number[] {
  return rows(
    'SELECT id FROM messages WHERE character_id = ? AND ts >= ? AND ts <= ? ORDER BY ts, id',
    [characterId, fromTs, toTs],
  ).map((row) => Number(row.id))
}

export function listMessagesAfter(characterId: string, afterTs: number, limit: number): MessageRow[] {
  return rows(
    'SELECT id, character_id, role, content, ts, archived FROM messages WHERE character_id = ? AND ts > ? ORDER BY ts, id LIMIT ?',
    [characterId, afterTs, Math.max(1, limit)],
  ) as unknown as MessageRow[]
}

// 重建前清空抽取层；原文、聊天记录、摘要都不动（摘要由压缩链路单独维护）
export function resetDerived(characterId: string): { facts: number, stories: number } {
  return withTx(() => {
    const facts = Number(db!.prepare("DELETE FROM memories WHERE character_id = ? AND kind = 'fact'").run(characterId).changes)
    const stories = Number(db!.prepare("DELETE FROM memories WHERE character_id = ? AND kind != 'fact'").run(characterId).changes)
    recordBulkChange(characterId, 'reset_derived', facts + stories)
    return { facts, stories }
  })
}
