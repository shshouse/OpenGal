import { db, rows, run, withTx, getMeta, setMeta } from './core'
import { factRowToMemory, insertMemoryRowRaw, isoToMs, memoryToFactRow, memoryToStoryRow, storyRowToMemory } from './memoryRows'
import type { MemoryRow, FactRow, StoryRow, MessageRow } from './types'

export function insertMemoryRow(characterId: string, row: MemoryRow): void {
  withTx(() => insertMemoryRowRaw(characterId, row))
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
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET state = ? WHERE id = ?').run(state, id).changes
  ))
}

export function setMemoryPinnedRow(id: string, pinned: boolean): number {
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id).changes
  ))
}

export function setMemoryEmbeddingRow(id: string, embedding: string): number {
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(embedding, id).changes
  ))
}

export function confirmMemoryRow(id: string, ts: number): number {
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET confirmed_at = ? WHERE id = ?').run(ts, id).changes
  ))
}

export function deleteMemoryRow(id: string): number {
  return withTx(() => Number(
    db!.prepare('DELETE FROM memories WHERE id = ?').run(id).changes
  ))
}

// 一条记忆的来源原话：优先用显式 messageIds，否则按记录的时间范围回查

export function clearCharacterMemories(characterId: string): void {
  withTx(() => {
    run('DELETE FROM memories WHERE character_id = ?', [characterId])
  })
}

export function listFacts(characterId: string): FactRow[] {
  return listMemoryRows(characterId, { includeInactive: true })
    .filter((row) => row.kind === 'fact')
    .map(memoryToFactRow)
}

export function saveFacts(characterId: string, items: FactRow[]): void {
  withTx(() => {
    run("DELETE FROM memories WHERE character_id = ? AND kind = 'fact'", [characterId])
    for (const item of items) insertMemoryRowRaw(characterId, factRowToMemory(characterId, item))
  })
}

export function insertFactRow(characterId: string, f: FactRow): void {
  insertMemoryRow(characterId, factRowToMemory(characterId, f))
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
  return withTx(() => Number(
    db!.prepare('UPDATE memories SET frozen_at = ?, pinned = ? WHERE id = ?')
      .run(frozenAt, frozenAt ? 1 : 0, id).changes
  ))
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
    run("DELETE FROM memories WHERE character_id = ? AND kind != 'fact'", [characterId])
    for (const item of items) insertMemoryRowRaw(characterId, storyRowToMemory(characterId, item))
  })
}

export function insertStoryRow(characterId: string, s: StoryRow): void {
  insertMemoryRow(characterId, storyRowToMemory(characterId, s))
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
  return withTx(() => ({
    facts: Number(db!.prepare("DELETE FROM memories WHERE character_id = ? AND kind = 'fact'").run(characterId).changes),
    stories: Number(db!.prepare("DELETE FROM memories WHERE character_id = ? AND kind != 'fact'").run(characterId).changes),
  }))
}
