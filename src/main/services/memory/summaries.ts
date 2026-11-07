import { rows, run, withTx } from './core'
import type { SummaryRow } from './types'

export function listSummaries(roleId: string): SummaryRow[] {
  return rows(
    'SELECT start_ts, end_ts, text, message_count FROM summaries WHERE role_id = ? ORDER BY created_at',
    [roleId]
  ) as unknown as SummaryRow[]
}

// 摘要只保留最近的若干条，更旧的删除（原文仍在，可重新摘要）
export function pruneSummaries(roleId: string, keep = 50): number {
  const all = rows(
    'SELECT id FROM summaries WHERE role_id = ? ORDER BY end_ts DESC, id DESC',
    [roleId]
  )
  if (all.length <= keep) return 0
  const drop = all.slice(keep).map((row) => Number(row.id))
  withTx(() => {
    for (const id of drop) run('DELETE FROM summaries WHERE id = ?', [id])
  })
  return drop.length
}

export function addSummary(roleId: string, s: SummaryRow): void {
  withTx(() => {
    run(
      'INSERT INTO summaries(role_id, start_ts, end_ts, text, message_count, created_at) VALUES(?, ?, ?, ?, ?, ?)',
      [roleId, s.start_ts, s.end_ts, s.text, s.message_count, Date.now()]
    )
  })
}
