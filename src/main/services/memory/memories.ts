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
  roleId: string,
  row: MemoryRow,
  actor: MemoryChangeActor = 'system',
): void {
  withTx(() => insertMemoryRowRaw(roleId, row, { actor }))
}

export function listMemoryRows(
  roleId: string,
  opts: { includeInactive?: boolean } = {},
): MemoryRow[] {
  const filter = opts.includeInactive ? '' : " AND state = 'active'"
  return rows(
    `SELECT * FROM memories WHERE role_id = ?${filter} ORDER BY created_at DESC, id`,
    [roleId]
  ) as unknown as MemoryRow[]
}

export function setMemoryStateRow(id: string, state: string): number {
  return withTx(() => {
    const before = loadForChange(id)
    const changed = Number(db!.prepare('UPDATE memories SET state = ? WHERE id = ?').run(state, id).changes)
    if (before && changed > 0) {
      recordMemoryFieldChange({ roleId: before.role_id, memoryId: id, field: 'state', oldValue: before.state, newValue: state })
    }
    return changed
  })
}

export function setMemoryPinnedRow(id: string, pinned: boolean): number {
  return withTx(() => {
    const before = loadForChange(id)
    const changed = Number(db!.prepare('UPDATE memories SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id).changes)
    if (before && changed > 0) {
      recordMemoryFieldChange({ roleId: before.role_id, memoryId: id, field: 'pinned', oldValue: String(before.pinned), newValue: pinned ? '1' : '0' })
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
      recordMemoryFieldChange({
        roleId: before.role_id,
        memoryId: id,
        field: 'confirmed_at',
        oldValue: before.confirmed_at === null || before.confirmed_at === undefined ? null : String(before.confirmed_at),
        newValue: String(ts),
      })
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
        roleId: before.role_id,
        action: 'delete',
        oldValue: JSON.stringify(before),
        actor: 'user',
      })
    }
    return changed
  })
}

// 一条记忆的来源原话：优先用显式 messageIds，否则按记录的时间范围回查

export function clearRoleMemories(roleId: string): void {
  withTx(() => {
    const before = Number(rows('SELECT COUNT(*) AS c FROM memories WHERE role_id = ?', [roleId])[0]?.c ?? 0)
    run('DELETE FROM memories WHERE role_id = ?', [roleId])
    recordBulkChange(roleId, 'clear', before, 'user')
  })
}

export function listFacts(roleId: string): FactRow[] {
  return listMemoryRows(roleId, { includeInactive: true })
    .filter((row) => row.kind === 'fact')
    .map(memoryToFactRow)
}

export function saveFacts(roleId: string, items: FactRow[]): void {
  withTx(() => {
    const before = Number(
      rows("SELECT COUNT(*) AS c FROM memories WHERE role_id = ? AND kind = 'fact'", [roleId])[0]?.c ?? 0
    )
    run("DELETE FROM memories WHERE role_id = ? AND kind = 'fact'", [roleId])
    for (const item of items) {
      insertMemoryRowRaw(roleId, factRowToMemory(roleId, item), { log: false })
    }
    recordBulkChange(roleId, 'rewrite_facts', before + items.length)
  })
}

export function insertFactRow(
  roleId: string,
  f: FactRow,
  actor: MemoryChangeActor = 'system',
): void {
  insertMemoryRow(roleId, factRowToMemory(roleId, f), actor)
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
      recordMemoryFieldChange({ roleId: before.role_id, memoryId: id, field: 'frozen_at', oldValue: before.frozen_at ?? null, newValue: frozenAt, actor: 'user' })
      recordMemoryFieldChange({ roleId: before.role_id, memoryId: id, field: 'pinned', oldValue: String(before.pinned), newValue: frozenAt ? '1' : '0', actor: 'user' })
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

export function listStories(roleId: string): StoryRow[] {
  return listMemoryRows(roleId, { includeInactive: true })
    .filter((row) => row.kind !== 'fact')
    .map(memoryToStoryRow)
}

export function saveStories(roleId: string, items: StoryRow[]): void {
  withTx(() => {
    const before = Number(
      rows("SELECT COUNT(*) AS c FROM memories WHERE role_id = ? AND kind != 'fact'", [roleId])[0]?.c ?? 0
    )
    run("DELETE FROM memories WHERE role_id = ? AND kind != 'fact'", [roleId])
    for (const item of items) {
      insertMemoryRowRaw(roleId, storyRowToMemory(roleId, item), { log: false })
    }
    recordBulkChange(roleId, 'rewrite_stories', before + items.length)
  })
}

export function insertStoryRow(
  roleId: string,
  s: StoryRow,
  actor: MemoryChangeActor = 'system',
): void {
  insertMemoryRow(roleId, storyRowToMemory(roleId, s), actor)
}

export function setStoryStatusRow(id: string, status: string): number {
  return setMemoryStateRow(id, status)
}

export function clearRoleMemory(roleId: string): void {
  clearRoleMemories(roleId)
}


export function getMemoryCursor(roleId: string): number {
  const raw = getMeta(`memory.cursor.${roleId}`)
  const parsed = raw ? Number(raw) : 0
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

export function setMemoryCursor(roleId: string, ts: number): void {
  setMeta(`memory.cursor.${roleId}`, String(Math.max(0, Math.floor(ts))))
}

// 第一次使用游标时不要回放整段历史：只回溯最近 N 条，避免升级后一次性重拉所有对话
export function isCursorInitialized(roleId: string): boolean {
  return getMeta(`memory.cursor.init.${roleId}`) === '1'
}

export function markCursorInitialized(roleId: string): void {
  setMeta(`memory.cursor.init.${roleId}`, '1')
}

export function bootstrapCursor(roleId: string, lookback: number): number {
  const found = rows(
    'SELECT ts FROM messages WHERE role_id = ? ORDER BY ts DESC LIMIT 1 OFFSET ?',
    [roleId, Math.max(0, lookback)],
  )
  const first = found[0]
  return first ? Number(first.ts) : 0
}

// 一批记忆对应的原文消息 id：用于回查“这条记忆是从哪句话来的”
export function listMessageIdsInRange(roleId: string, fromTs: number, toTs: number): number[] {
  return rows(
    'SELECT id FROM messages WHERE role_id = ? AND ts >= ? AND ts <= ? ORDER BY ts, id',
    [roleId, fromTs, toTs],
  ).map((row) => Number(row.id))
}

export function listMessagesAfter(roleId: string, afterTs: number, limit: number): MessageRow[] {
  return rows(
    'SELECT id, role_id, role, content, ts, archived FROM messages WHERE role_id = ? AND ts > ? ORDER BY ts, id LIMIT ?',
    [roleId, afterTs, Math.max(1, limit)],
  ) as unknown as MessageRow[]
}

// 重建前清空抽取层；原文、聊天记录、摘要都不动（摘要由压缩链路单独维护）
export function resetDerived(roleId: string): { facts: number, stories: number } {
  return withTx(() => {
    const facts = Number(db!.prepare("DELETE FROM memories WHERE role_id = ? AND kind = 'fact'").run(roleId).changes)
    const stories = Number(db!.prepare("DELETE FROM memories WHERE role_id = ? AND kind != 'fact'").run(roleId).changes)
    recordBulkChange(roleId, 'reset_derived', facts + stories)
    return { facts, stories }
  })
}
