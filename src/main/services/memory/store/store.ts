import { findHandleByMemoryId, openRoleDb } from '../db/core'
import { toMemory, toRow, type Memory, type MemoryState } from '../model/model'
import { insertMemoryRowRaw } from './memoryRows'
import {
  clearRoleMemories,
  deleteMemoryRow,
  listMemoryRows,
  setFactFrozenRow,
  setMemoryEmbeddingRow,
  setMemoryPinnedRow,
  setMemoryStateRow,
} from './memories'
import { syncRoleMemoryCountSummary } from './roleState'
import type { MemoryChangeActor } from '../db/changelog'

export function listMemories(roleId: string): Memory[] {
  return listMemoryRows(roleId, { includeInactive: true })
    .map(toMemory)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function insertMemory(roleId: string, memory: Memory, actor: MemoryChangeActor = 'system'): void {
  const handle = openRoleDb(roleId)
  handle.port.transaction(() => {
    insertMemoryRowRaw(roleId, toRow(memory), { actor })
    for (const messageId of memory.evidence.messageIds ?? []) {
      handle.port.run(
        'INSERT OR IGNORE INTO memory_sources(memory_id, message_id) VALUES(?, ?)',
        [memory.id, messageId],
      )
    }
  })
  syncRoleMemoryCountSummary(roleId)
}

export function setMemoryState(id: string, state: MemoryState, roleId?: string): number {
  return setMemoryStateRow(id, state, roleId)
}

export function setMemoryPinned(id: string, pinned: boolean, roleId?: string): number {
  return setMemoryPinnedRow(id, pinned, roleId)
}

export function setMemoryFrozen(id: string, frozenAt: string | null, roleId?: string): number {
  return setFactFrozenRow(id, frozenAt, roleId)
}

export function setMemoryEmbedding(id: string, embedding: number[], roleId?: string): number {
  return setMemoryEmbeddingRow(id, JSON.stringify(embedding), roleId)
}

export function deleteMemory(id: string, roleId?: string): number {
  return deleteMemoryRow(id, roleId)
}

export function clearMemories(roleId: string): void {
  clearRoleMemories(roleId)
}

export function markRecalled(ids: string[], roleId?: string): void {
  if (ids.length === 0) return
  if (roleId) {
    const handle = openRoleDb(roleId)
    handle.port.transaction(() => {
      const placeholders = ids.map(() => '?').join(', ')
      handle.port.run(`UPDATE memories SET reinforce = reinforce + 1 WHERE id IN (${placeholders})`, ids)
    })
    return
  }
  for (const id of ids) {
    const handle = findHandleByMemoryId(id)
    if (handle) handle.port.run('UPDATE memories SET reinforce = reinforce + 1 WHERE id = ?', [id])
  }
}

export function reinforceMemory(id: string, at = Date.now(), roleId?: string): void {
  const handle = findHandleByMemoryId(id, roleId)
  if (!handle) return
  handle.port.transaction(() => {
    handle.port.run('UPDATE memories SET confirmed_at = ?, reinforce = reinforce + 1 WHERE id = ?', [at, id])
  })
}

/** 合并重复情节：把发生时间挪到这一次，并累加印证次数。 */
export function refreshEpisode(id: string, at = Date.now(), roleId?: string): void {
  const handle = findHandleByMemoryId(id, roleId)
  if (!handle) return
  handle.port.transaction(() => {
    handle.port.run(
      'UPDATE memories SET happened_at = ?, confirmed_at = ?, reinforce = reinforce + 1 WHERE id = ?',
      [at, at, id],
    )
  })
}
