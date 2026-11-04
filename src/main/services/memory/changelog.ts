import { db, logger, rows, withTx } from './core'
import { getErrorMessage } from '@shared/errors'
import type { MemoryChange } from '@shared/types'

export type MemoryChangeAction = 'insert' | 'update' | 'delete'
export type MemoryChangeActor = 'llm' | 'user' | 'arbitration' | 'system'

export const CHANGE_FIELDS = {
  state: 'state',
  pinned: 'pinned',
  confirmed_at: 'confirmed_at',
  frozen_at: 'frozen_at',
} as const

export type MemoryChangeField = keyof typeof CHANGE_FIELDS

const COLUMNS = 'seq, memory_id, character_id, action, field, old_value, new_value, actor, reason, ts'

// 日志是旁路：写失败只记录，不让它回滚已经生效的记忆变更
export function recordMemoryChange(input: {
  memoryId: string
  characterId: string
  action: MemoryChangeAction
  field?: string | null
  oldValue?: string | null
  newValue?: string | null
  actor?: MemoryChangeActor
  reason?: string | null
}): void {
  if (!db) return
  try {
    db.prepare(
      'INSERT INTO memory_changelog(memory_id, character_id, action, field, old_value, new_value, actor, reason, ts) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      input.memoryId,
      input.characterId,
      input.action,
      input.field ?? null,
      input.oldValue ?? null,
      input.newValue ?? null,
      input.actor ?? 'system',
      input.reason ?? null,
      Date.now(),
    )
  } catch (err) {
    logger.warn('memory', `变更记录写入失败 ${input.memoryId}/${input.action}: ${getErrorMessage(err)}`)
  }
}

export function recordMemoryFieldChange(
  characterId: string,
  memoryId: string,
  field: MemoryChangeField,
  oldValue: string | null,
  newValue: string | null,
  actor: MemoryChangeActor = 'system',
): void {
  if (oldValue === newValue) return
  recordMemoryChange({ memoryId, characterId, action: 'update', field, oldValue, newValue, actor })
}

// 批量重写只留一条汇总，逐条记录会让一次重建刷出上千行
export function recordBulkChange(
  characterId: string,
  action: string,
  count: number,
  actor: MemoryChangeActor = 'system',
): void {
  if (count <= 0) return
  recordMemoryChange({
    memoryId: '',
    characterId,
    action: 'delete',
    newValue: String(count),
    actor,
    reason: action,
  })
}

export function listMemoryChanges(characterId: string, memoryId: string, limit = 20): MemoryChange[] {
  return rows(
    `SELECT ${COLUMNS} FROM memory_changelog WHERE character_id = ? AND memory_id = ? ORDER BY seq DESC LIMIT ?`,
    [characterId, memoryId, Math.max(1, limit)],
  ) as unknown as MemoryChange[]
}

export function listCharacterMemoryChanges(characterId: string, limit = 200): MemoryChange[] {
  return rows(
    `SELECT ${COLUMNS} FROM memory_changelog WHERE character_id = ? ORDER BY seq DESC LIMIT ?`,
    [characterId, Math.max(1, limit)],
  ) as unknown as MemoryChange[]
}

// 只回滚 update 与 delete；insert 的撤销等同删除，由调用方决定
export function restoreMemoryChange(characterId: string, seq: number): boolean {
  const found = rows(`SELECT ${COLUMNS} FROM memory_changelog WHERE seq = ? AND character_id = ?`, [seq, characterId])
  const change = found[0] as unknown as MemoryChange | undefined
  if (!change) return false
  return withTx(() => {
    if (change.action === 'update') {
      if (!change.field || !(change.field in CHANGE_FIELDS)) return false
      db!
        .prepare(`UPDATE memories SET ${CHANGE_FIELDS[change.field as MemoryChangeField]} = ? WHERE id = ?`)
        .run(change.old_value, change.memory_id)
      return true
    }
    if (change.action === 'delete' && change.old_value) {
      const snapshot = JSON.parse(change.old_value) as Record<string, unknown>
      const keys = Object.keys(snapshot)
      // 列名来自本模块自己写入的行快照，不接受外部输入
      db!
        .prepare(
          `INSERT OR REPLACE INTO memories(${keys.join(', ')}) VALUES(${keys.map(() => '?').join(', ')})`
        )
        .run(...keys.map((key) => snapshot[key] as never))
      return true
    }
    return false
  })
}
