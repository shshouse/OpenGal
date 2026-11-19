import {
  findHandleByMemoryId,
  getRoleMeta,
  openRoleDb,
  setRoleMeta,
  type RoleDbHandle,
} from '../db/core'
import {
  factRowToMemory,
  insertMemoryRowRaw,
  isoToMs,
  memoryToFactRow,
  memoryToStoryRow,
  storyRowToMemory,
} from './memoryRows'
import {
  recordBulkChange,
  recordMemoryChange,
  recordMemoryFieldChange,
  type MemoryChangeActor,
} from '../db/changelog'
import { toMessageRow } from './search'
import { syncRoleMemoryCountSummary } from './roleState'
import type { MemoryRow, FactRow, StoryRow, MessageRow } from '../model/types'

function withRoleId(roleId: string, row: Omit<MemoryRow, 'role_id'>): MemoryRow {
  return { ...row, role_id: roleId } as MemoryRow
}

function loadForChange(handle: RoleDbHandle, id: string): MemoryRow | null {
  const found = handle.port.query<Omit<MemoryRow, 'role_id'>>('SELECT * FROM memories WHERE id = ?', [id])
  return found[0] ? withRoleId(handle.roleId, found[0]) : null
}

export function insertMemoryRow(
  roleId: string,
  row: MemoryRow,
  actor: MemoryChangeActor = 'system',
): void {
  const handle = openRoleDb(roleId)
  handle.port.transaction(() => insertMemoryRowRaw(roleId, row, { actor }))
  syncRoleMemoryCountSummary(roleId)
}

export function listMemoryRows(
  roleId: string,
  opts: { includeInactive?: boolean } = {},
): MemoryRow[] {
  const filter = opts.includeInactive ? '' : " WHERE state = 'active'"
  return openRoleDb(roleId)
    .port.query<Omit<MemoryRow, 'role_id'>>(
      `SELECT * FROM memories${filter} ORDER BY created_at DESC, id`,
    )
    .map((row) => withRoleId(roleId, row))
}

export function setMemoryStateRow(id: string, state: string, roleId?: string): number {
  const handle = findHandleByMemoryId(id, roleId)
  if (!handle) return 0
  const changed = handle.port.transaction(() => {
    const before = loadForChange(handle, id)
    const count = handle.port.run('UPDATE memories SET state = ? WHERE id = ?', [state, id]).changes
    if (before && count > 0) {
      recordMemoryFieldChange({
        roleId: handle.roleId,
        memoryId: id,
        field: 'state',
        oldValue: before.state,
        newValue: state,
      })
    }
    return count
  })
  if (changed > 0) syncRoleMemoryCountSummary(handle.roleId)
  return changed
}

export function setMemoryPinnedRow(id: string, pinned: boolean, roleId?: string): number {
  const handle = findHandleByMemoryId(id, roleId)
  if (!handle) return 0
  return handle.port.transaction(() => {
    const before = loadForChange(handle, id)
    const changed = handle.port.run('UPDATE memories SET pinned = ? WHERE id = ?', [
      pinned ? 1 : 0,
      id,
    ]).changes
    if (before && changed > 0) {
      recordMemoryFieldChange({
        roleId: handle.roleId,
        memoryId: id,
        field: 'pinned',
        oldValue: String(before.pinned),
        newValue: pinned ? '1' : '0',
      })
    }
    return changed
  })
}

export function setMemoryEmbeddingRow(id: string, embedding: string, roleId?: string): number {
  const handle = findHandleByMemoryId(id, roleId)
  if (!handle) return 0
  return handle.port.transaction(
    () => handle.port.run('UPDATE memories SET embedding = ? WHERE id = ?', [embedding, id]).changes,
  )
}

export function confirmMemoryRow(id: string, ts: number, roleId?: string): number {
  const handle = findHandleByMemoryId(id, roleId)
  if (!handle) return 0
  return handle.port.transaction(() => {
    const before = loadForChange(handle, id)
    const changed = handle.port.run('UPDATE memories SET confirmed_at = ? WHERE id = ?', [ts, id]).changes
    if (before && changed > 0) {
      recordMemoryFieldChange({
        roleId: handle.roleId,
        memoryId: id,
        field: 'confirmed_at',
        oldValue:
          before.confirmed_at === null || before.confirmed_at === undefined
            ? null
            : String(before.confirmed_at),
        newValue: String(ts),
      })
    }
    return changed
  })
}

export function deleteMemoryRow(id: string, roleId?: string): number {
  const handle = findHandleByMemoryId(id, roleId)
  if (!handle) return 0
  const changed = handle.port.transaction(() => {
    const before = loadForChange(handle, id)
    handle.port.run('DELETE FROM memory_sources WHERE memory_id = ?', [id])
    const count = handle.port.run('DELETE FROM memories WHERE id = ?', [id]).changes
    if (before && count > 0) {
      recordMemoryChange({
        memoryId: id,
        roleId: handle.roleId,
        action: 'delete',
        oldValue: JSON.stringify(before),
        actor: 'user',
      })
    }
    return count
  })
  if (changed > 0) syncRoleMemoryCountSummary(handle.roleId)
  return changed
}

export function clearRoleMemories(roleId: string): void {
  const handle = openRoleDb(roleId)
  handle.port.transaction(() => {
    const before = Number(
      handle.port.query<{ c: number }>('SELECT COUNT(*) AS c FROM memories')[0]?.c ?? 0,
    )
    handle.port.run('DELETE FROM memory_sources')
    handle.port.run('DELETE FROM memories')
    recordBulkChange(roleId, 'clear', before, 'user')
  })
  syncRoleMemoryCountSummary(roleId)
}

export function listFacts(roleId: string): FactRow[] {
  return listMemoryRows(roleId, { includeInactive: true })
    .filter((row) => row.kind === 'fact')
    .map(memoryToFactRow)
}

export function saveFacts(roleId: string, items: FactRow[]): void {
  const handle = openRoleDb(roleId)
  handle.port.transaction(() => {
    const before = Number(
      handle.port.query<{ c: number }>("SELECT COUNT(*) AS c FROM memories WHERE kind = 'fact'")[0]?.c ?? 0,
    )
    handle.port.run("DELETE FROM memories WHERE kind = 'fact'")
    for (const item of items) {
      insertMemoryRowRaw(roleId, factRowToMemory(roleId, item), { log: false })
    }
    recordBulkChange(roleId, 'rewrite_facts', before + items.length)
  })
  syncRoleMemoryCountSummary(roleId)
}

export function insertFactRow(
  roleId: string,
  f: FactRow,
  actor: MemoryChangeActor = 'system',
): void {
  insertMemoryRow(roleId, factRowToMemory(roleId, f), actor)
}

export function getFactRow(id: string, roleId?: string): FactRow | null {
  const handle = findHandleByMemoryId(id, roleId)
  if (!handle) return null
  const found = handle.port.query<Omit<MemoryRow, 'role_id'>>('SELECT * FROM memories WHERE id = ?', [id])
  return found[0] ? memoryToFactRow(withRoleId(handle.roleId, found[0])) : null
}

export function reinforceFactRow(id: string, ts: string, roleId?: string): number {
  return confirmMemoryRow(id, isoToMs(ts), roleId)
}

export function negateFactRow(id: string, roleId?: string): number {
  return setMemoryStateRow(id, 'archived', roleId)
}

export function setFactStatusRow(id: string, status: string, roleId?: string): number {
  return setMemoryStateRow(id, status, roleId)
}

export function setFactFrozenRow(id: string, frozenAt: string | null, roleId?: string): number {
  const handle = findHandleByMemoryId(id, roleId)
  if (!handle) return 0
  return handle.port.transaction(() => {
    const before = loadForChange(handle, id)
    const changed = handle.port.run(
      'UPDATE memories SET frozen_at = ?, pinned = ? WHERE id = ?',
      [frozenAt, frozenAt ? 1 : 0, id],
    ).changes
    if (before && changed > 0) {
      recordMemoryFieldChange({
        roleId: handle.roleId,
        memoryId: id,
        field: 'frozen_at',
        oldValue: before.frozen_at ?? null,
        newValue: frozenAt,
        actor: 'user',
      })
      recordMemoryFieldChange({
        roleId: handle.roleId,
        memoryId: id,
        field: 'pinned',
        oldValue: String(before.pinned),
        newValue: frozenAt ? '1' : '0',
        actor: 'user',
      })
    }
    return changed
  })
}

export function setFactEmbeddingRow(id: string, embedding: string, roleId?: string): number {
  return setMemoryEmbeddingRow(id, embedding, roleId)
}

export function deleteFactRow(id: string, roleId?: string): number {
  return deleteMemoryRow(id, roleId)
}

export function listStories(roleId: string): StoryRow[] {
  return listMemoryRows(roleId, { includeInactive: true })
    .filter((row) => row.kind !== 'fact')
    .map(memoryToStoryRow)
}

export function saveStories(roleId: string, items: StoryRow[]): void {
  const handle = openRoleDb(roleId)
  handle.port.transaction(() => {
    const before = Number(
      handle.port.query<{ c: number }>("SELECT COUNT(*) AS c FROM memories WHERE kind != 'fact'")[0]?.c ?? 0,
    )
    handle.port.run("DELETE FROM memories WHERE kind != 'fact'")
    for (const item of items) {
      insertMemoryRowRaw(roleId, storyRowToMemory(roleId, item), { log: false })
    }
    recordBulkChange(roleId, 'rewrite_stories', before + items.length)
  })
  syncRoleMemoryCountSummary(roleId)
}

export function insertStoryRow(
  roleId: string,
  s: StoryRow,
  actor: MemoryChangeActor = 'system',
): void {
  insertMemoryRow(roleId, storyRowToMemory(roleId, s), actor)
}

export function setStoryStatusRow(id: string, status: string, roleId?: string): number {
  return setMemoryStateRow(id, status, roleId)
}

export function clearRoleMemory(roleId: string): void {
  clearRoleMemories(roleId)
}

export function getMemoryCursor(roleId: string): number {
  const raw = getRoleMeta(roleId, 'memory.cursor')
  const parsed = raw ? Number(raw) : 0
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

export function setMemoryCursor(roleId: string, ts: number): void {
  setRoleMeta(roleId, 'memory.cursor', String(Math.max(0, Math.floor(ts))))
}

export function isCursorInitialized(roleId: string): boolean {
  return getRoleMeta(roleId, 'memory.cursor.init') === '1'
}

export function markCursorInitialized(roleId: string): void {
  setRoleMeta(roleId, 'memory.cursor.init', '1')
}

export function bootstrapCursor(roleId: string, lookback: number): number {
  const found = openRoleDb(roleId).port.query<{ ts: number }>(
    'SELECT ts FROM messages ORDER BY ts DESC LIMIT 1 OFFSET ?',
    [Math.max(0, lookback)],
  )
  return found[0] ? Number(found[0].ts) : 0
}

export function listMessageIdsInRange(roleId: string, fromTs: number, toTs: number): number[] {
  return openRoleDb(roleId)
    .port.query<{ id: number }>(
      'SELECT id FROM messages WHERE ts >= ? AND ts <= ? ORDER BY ts, id',
      [fromTs, toTs],
    )
    .map((row) => Number(row.id))
}

export function listMessagesAfter(roleId: string, afterTs: number, limit: number): MessageRow[] {
  return openRoleDb(roleId)
    .port.query<{ id: number; role: string; content: string; ts: number; archived: number; kind?: string }>(
      'SELECT id, role, content, ts, archived, kind FROM messages WHERE ts > ? ORDER BY ts, id LIMIT ?',
      [afterTs, Math.max(1, limit)],
    )
    .map((row) => toMessageRow(roleId, row))
}

export function resetDerived(roleId: string): { facts: number; stories: number } {
  const handle = openRoleDb(roleId)
  const out = handle.port.transaction(() => {
    handle.port.run('DELETE FROM memory_sources')
    const facts = handle.port.run("DELETE FROM memories WHERE kind = 'fact'").changes
    const stories = handle.port.run("DELETE FROM memories WHERE kind != 'fact'").changes
    recordBulkChange(roleId, 'reset_derived', facts + stories)
    return { facts, stories }
  })
  syncRoleMemoryCountSummary(roleId)
  return out
}
