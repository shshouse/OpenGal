import { openRoleDb } from '../db/core'
import type { SummaryRow } from '../model/types'

export function listSummaries(roleId: string): SummaryRow[] {
  return openRoleDb(roleId).port.query<SummaryRow>(
    'SELECT start_ts, end_ts, text, message_count FROM summaries ORDER BY created_at',
  )
}

export function pruneSummaries(roleId: string, keep = 50): number {
  const handle = openRoleDb(roleId)
  const all = handle.port.query<{ id: number }>(
    'SELECT id FROM summaries ORDER BY end_ts DESC, id DESC',
  )
  if (all.length <= keep) return 0
  const drop = all.slice(keep).map((row) => Number(row.id))
  handle.port.transaction(() => {
    for (const id of drop) handle.port.run('DELETE FROM summaries WHERE id = ?', [id])
  })
  return drop.length
}

export function addSummary(roleId: string, s: SummaryRow): void {
  const handle = openRoleDb(roleId)
  handle.port.transaction(() => {
    handle.port.run(
      'INSERT INTO summaries(start_ts, end_ts, text, message_count, created_at) VALUES(?, ?, ?, ?, ?)',
      [s.start_ts, s.end_ts, s.text, s.message_count, Date.now()],
    )
  })
}
