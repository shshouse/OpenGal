import { db, rows, withTx } from './core'
import { toMemory, toRow, parseEvidence, formatEvidence, type Memory, type MemoryState } from './model'
import {
  clearRoleMemories,
  deleteMemoryRow,
  insertMemoryRow,
  listMemoryRows,
  setFactFrozenRow,
  setMemoryEmbeddingRow,
  setMemoryPinnedRow,
  setMemoryStateRow,
} from './memories'
import type { MemoryChangeActor } from './changelog'
import type { MemoryRow } from './types'

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
  insertMemoryRow(roleId, toRow(memory), actor)
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
  return deleteMemoryRow(id)
}

export function clearMemories(roleId: string): void {
  clearRoleMemories(roleId)
}

/** 被想起或被重新确认：刷新确认时间，并把印证次数写进 evidence。 */
export function reinforceMemory(id: string, at = Date.now()): void {
  withTx(() => {
    const found = rows('SELECT * FROM memories WHERE id = ?', [id])[0] as unknown as MemoryRow | undefined
    if (!found) return
    const evidence = parseEvidence(found.evidence)
    evidence.reinforce += 1
    db!.prepare('UPDATE memories SET confirmed_at = ?, evidence = ? WHERE id = ?')
      .run(at, formatEvidence(evidence), id)
  })
}
