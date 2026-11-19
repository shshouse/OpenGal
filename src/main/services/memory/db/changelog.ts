import { listOpenRoleHandles, logger, openRoleDb } from './core'
import { getErrorMessage } from '@shared/app/errors'
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

const COLUMNS = 'seq, memory_id, action, field, old_value, new_value, actor, reason, ts'

interface RawChangeRow {
  seq: number
  memory_id: string
  action: MemoryChangeAction
  field: string | null
  old_value: string | null
  new_value: string | null
  actor: MemoryChangeActor
  reason: string | null
  ts: number
}

function toMemoryChange(roleId: string, row: RawChangeRow): MemoryChange {
  return {
    ...row,
    role_id: roleId,
  } as unknown as MemoryChange
}

export function recordMemoryChange(input: {
  memoryId: string
  roleId: string
  action: MemoryChangeAction
  field?: string | null
  oldValue?: string | null
  newValue?: string | null
  actor?: MemoryChangeActor
  reason?: string | null
}): void {
  try {
    openRoleDb(input.roleId).port.run(
      'INSERT INTO memory_changelog(memory_id, action, field, old_value, new_value, actor, reason, ts) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
      [
        input.memoryId,
        input.action,
        input.field ?? null,
        input.oldValue ?? null,
        input.newValue ?? null,
        input.actor ?? 'system',
        input.reason ?? null,
        Date.now(),
      ],
    )
  } catch (err) {
    logger.warn('memory', `变更记录写入失败 ${input.memoryId}/${input.action}: ${getErrorMessage(err)}`)
  }
}

export interface MemoryFieldChange {
  roleId: string
  memoryId: string
  field: MemoryChangeField
  oldValue: string | null
  newValue: string | null
  actor?: MemoryChangeActor
}

export function recordMemoryFieldChange(change: MemoryFieldChange): void {
  if (change.oldValue === change.newValue) return
  recordMemoryChange({ ...change, action: 'update', actor: change.actor ?? 'system' })
}

export function recordBulkChange(
  roleId: string,
  action: string,
  count: number,
  actor: MemoryChangeActor = 'system',
): void {
  if (count <= 0) return
  recordMemoryChange({
    memoryId: '',
    roleId,
    action: 'delete',
    newValue: String(count),
    actor,
    reason: action,
  })
}

export function listMemoryChanges(roleId: string, memoryId: string, limit = 20): MemoryChange[] {
  return openRoleDb(roleId)
    .port.query<RawChangeRow>(
      `SELECT ${COLUMNS} FROM memory_changelog WHERE memory_id = ? ORDER BY seq DESC LIMIT ?`,
      [memoryId, Math.max(1, limit)],
    )
    .map((row) => toMemoryChange(roleId, row))
}

export function listRoleMemoryChanges(roleId: string, limit = 200): MemoryChange[] {
  return openRoleDb(roleId)
    .port.query<RawChangeRow>(
      `SELECT ${COLUMNS} FROM memory_changelog ORDER BY seq DESC LIMIT ?`,
      [Math.max(1, limit)],
    )
    .map((row) => toMemoryChange(roleId, row))
}

export function pruneMemoryChangelog(keepPerRole: number, roleId?: string): number {
  if (!Number.isSafeInteger(keepPerRole) || keepPerRole < 1) {
    throw new RangeError('keepPerRole 必须是正整数')
  }
  const pruneOne = (id: string): number =>
    openRoleDb(id).port.run(
      `DELETE FROM memory_changelog WHERE seq NOT IN (
        SELECT seq FROM memory_changelog ORDER BY seq DESC LIMIT ?
      )`,
      [keepPerRole],
    ).changes

  if (roleId) return pruneOne(roleId)
  let total = 0
  for (const handle of listOpenRoleHandles()) {
    if (handle.roleId === '_system') continue
    total += pruneOne(handle.roleId)
  }
  return total
}

export function restoreMemoryChange(roleId: string, seq: number): boolean {
  const handle = openRoleDb(roleId)
  const found = handle.port.query<RawChangeRow>(
    `SELECT ${COLUMNS} FROM memory_changelog WHERE seq = ?`,
    [seq],
  )
  const change = found[0]
  if (!change) return false
  return handle.port.transaction(() => {
    if (change.action === 'update') {
      if (!change.field || !(change.field in CHANGE_FIELDS)) return false
      handle.port.run(
        `UPDATE memories SET ${CHANGE_FIELDS[change.field as MemoryChangeField]} = ? WHERE id = ?`,
        [change.old_value, change.memory_id],
      )
      return true
    }
    if (change.action === 'delete' && change.old_value) {
      const snapshot = JSON.parse(change.old_value) as Record<string, unknown>
      delete snapshot.role_id
      const keys = Object.keys(snapshot)
      handle.port.run(
        `INSERT OR REPLACE INTO memories(${keys.join(', ')}) VALUES(${keys.map(() => '?').join(', ')})`,
        keys.map((key) => (snapshot[key] ?? null) as string | number | null),
      )
      return true
    }
    return false
  })
}
