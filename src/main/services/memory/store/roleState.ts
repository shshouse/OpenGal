import fs from 'node:fs'
import path from 'node:path'
import {
  createDefaultRoleState,
  createDefaultRoleSummary,
  type LifeLogEntry,
  type LifeLogKind,
  type RoleStateSnapshot,
  type RoleSummaryMeta,
} from '@core/role/types'
import { openRoleDb, resolveRoleDbDir } from '../db/core'

const SUMMARY_FILE = 'summary.json'

interface RawStateRow {
  mood: string
  energy: number
  relationship_stage: string
  current_activity: string
  short_term_goal: string
  next_tick_at: number | null
  updated_at: number
}

export function readRoleSummaryCache(roleDir: string): RoleSummaryMeta {
  const file = path.join(roleDir, SUMMARY_FILE)
  if (!fs.existsSync(file)) return createDefaultRoleSummary(0)
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<RoleSummaryMeta>
    return {
      lastActiveAt: typeof raw.lastActiveAt === 'number' ? raw.lastActiveAt : 0,
      lastMessagePreview: typeof raw.lastMessagePreview === 'string' ? raw.lastMessagePreview : '',
      mood: typeof raw.mood === 'string' ? raw.mood : 'neutral',
      energy: typeof raw.energy === 'number' ? raw.energy : 85,
      currentActivity: typeof raw.currentActivity === 'string' ? raw.currentActivity : '待机中',
      memoryCount: typeof raw.memoryCount === 'number' ? raw.memoryCount : 0,
    }
  } catch {
    return createDefaultRoleSummary(0)
  }
}

export function writeRoleSummaryCache(roleId: string, patch: Partial<RoleSummaryMeta>): void {
  const { roleDir } = resolveRoleDbDir(roleId)
  if (!fs.existsSync(roleDir)) return
  try {
    const prev = readRoleSummaryCache(roleDir)
    const next: RoleSummaryMeta = { ...prev, ...patch }
    fs.writeFileSync(path.join(roleDir, SUMMARY_FILE), JSON.stringify(next, null, 2), 'utf-8')
  } catch {
    // 摘要缓存为列表加速层，写失败不阻断数据库事务
  }
}

export function syncRoleMemoryCountSummary(roleId: string): void {
  const handle = openRoleDb(roleId)
  const count = Number(
    handle.port.query<{ c: number }>("SELECT COUNT(*) AS c FROM memories WHERE state = 'active'")[0]?.c ?? 0,
  )
  writeRoleSummaryCache(roleId, { memoryCount: count })
}

export function getRoleState(roleId: string): RoleStateSnapshot {
  const handle = openRoleDb(roleId)
  const row = handle.port.query<RawStateRow>('SELECT * FROM state WHERE id = 1')[0]
  if (!row) return createDefaultRoleState()
  return {
    mood: row.mood,
    energy: row.energy,
    relationshipStage: row.relationship_stage,
    currentActivity: row.current_activity,
    shortTermGoal: row.short_term_goal,
    nextTickAt: row.next_tick_at ?? null,
    updatedAt: row.updated_at,
  }
}

export function patchRoleState(
  roleId: string,
  patch: Partial<Omit<RoleStateSnapshot, 'updatedAt'>>,
): RoleStateSnapshot {
  const handle = openRoleDb(roleId)
  const current = getRoleState(roleId)
  const now = Date.now()
  const next: RoleStateSnapshot = {
    mood: patch.mood ?? current.mood,
    energy:
      typeof patch.energy === 'number' && Number.isFinite(patch.energy)
        ? Math.max(0, Math.min(100, Math.round(patch.energy)))
        : current.energy,
    relationshipStage: patch.relationshipStage ?? current.relationshipStage,
    currentActivity: patch.currentActivity ?? current.currentActivity,
    shortTermGoal: patch.shortTermGoal ?? current.shortTermGoal,
    nextTickAt: patch.nextTickAt !== undefined ? patch.nextTickAt : current.nextTickAt,
    updatedAt: now,
  }

  handle.port.run(
    `INSERT OR REPLACE INTO state(id, mood, energy, relationship_stage, current_activity, short_term_goal, next_tick_at, updated_at)
     VALUES(1, ?, ?, ?, ?, ?, ?, ?)`,
    [
      next.mood,
      next.energy,
      next.relationshipStage,
      next.currentActivity,
      next.shortTermGoal,
      next.nextTickAt,
      next.updatedAt,
    ],
  )

  writeRoleSummaryCache(roleId, {
    mood: next.mood,
    energy: next.energy,
    currentActivity: next.currentActivity,
    lastActiveAt: now,
  })

  return next
}

export function appendLifeLog(
  roleId: string,
  entry: {
    kind: LifeLogKind
    title?: string
    content: string
    mood?: string | null
    ts?: number
  },
): LifeLogEntry {
  const handle = openRoleDb(roleId)
  const ts = entry.ts ?? Date.now()
  const title = entry.title?.trim() ?? ''
  const content = entry.content.trim()
  const mood = entry.mood ?? null
  const info = handle.port.run(
    'INSERT INTO life_log(kind, title, content, mood, ts) VALUES(?, ?, ?, ?, ?)',
    [entry.kind, title, content, mood, ts],
  )
  return {
    id: info.lastInsertRowid,
    kind: entry.kind,
    title,
    content,
    mood,
    ts,
  }
}

export function listLifeLogs(
  roleId: string,
  opts: { kind?: LifeLogKind; limit?: number } = {},
): LifeLogEntry[] {
  const handle = openRoleDb(roleId)
  const limit = Math.max(1, Math.min(500, opts.limit ?? 50))
  const rows = opts.kind
    ? handle.port.query<LifeLogEntry>(
        'SELECT id, kind, title, content, mood, ts FROM life_log WHERE kind = ? ORDER BY ts DESC, id DESC LIMIT ?',
        [opts.kind, limit],
      )
    : handle.port.query<LifeLogEntry>(
        'SELECT id, kind, title, content, mood, ts FROM life_log ORDER BY ts DESC, id DESC LIMIT ?',
        [limit],
      )
  return rows.reverse()
}

export function clearLifeLogs(roleId: string): number {
  return openRoleDb(roleId).port.run('DELETE FROM life_log').changes
}
