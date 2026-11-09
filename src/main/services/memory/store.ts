import { db, run, withTx } from './core'
import { toMemory, toRow, type Memory, type MemoryState } from './model'
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
import type { MemoryChangeActor } from './changelog'

/**
 * 运行期只认 Memory 一种模型：读写、召回、写入都走这里。
 * 旧的行模型（facts/stories）保留在 project 层给界面和旧导入用。
 */
export function listMemories(roleId: string): Memory[] {
  return listMemoryRows(roleId, { includeInactive: true })
    .map(toMemory)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function insertMemory(roleId: string, memory: Memory, actor: MemoryChangeActor = 'system'): void {
  withTx(() => {
    insertMemoryRowRaw(roleId, toRow(memory), { actor })
    for (const messageId of memory.evidence.messageIds ?? []) {
      run(
        'INSERT OR IGNORE INTO memory_sources(memory_id, role_id, message_id) VALUES(?, ?, ?)',
        [memory.id, roleId, messageId],
      )
    }
  })
}

export function setMemoryState(id: string, state: MemoryState): number {
  return setMemoryStateRow(id, state)
}

export function setMemoryPinned(id: string, pinned: boolean): number {
  return setMemoryPinnedRow(id, pinned)
}

export function setMemoryFrozen(id: string, frozenAt: string | null): number {
  return setFactFrozenRow(id, frozenAt)
}

export function setMemoryEmbedding(id: string, embedding: number[]): number {
  return setMemoryEmbeddingRow(id, JSON.stringify(embedding))
}

export function deleteMemory(id: string): number {
  run('DELETE FROM memory_sources WHERE memory_id = ?', [id])
  return deleteMemoryRow(id)
}

export function clearMemories(roleId: string): void {
  clearRoleMemories(roleId)
}

/** 被写进上下文：只累加印证次数。确认时间代表"用户说过"，不能被读取行为刷新。 */
export function markRecalled(ids: string[]): void {
  if (ids.length === 0) return
  withTx(() => {
    const placeholders = ids.map(() => '?').join(', ')
    db!.prepare(`UPDATE memories SET reinforce = reinforce + 1 WHERE id IN (${placeholders})`).run(...ids)
  })
}

/** 被重新确认：刷新确认时间，并累加印证次数。 */
export function reinforceMemory(id: string, at = Date.now()): void {
  withTx(() => {
    db!.prepare('UPDATE memories SET confirmed_at = ?, reinforce = reinforce + 1 WHERE id = ?').run(at, id)
  })
}
