import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getErrorMessage } from '@shared/app/errors'
import { getModRoot } from '../../infra/paths'
import { listModsByCapability } from '../../mods/scanner'
import { findRoleFolderById, materializeRole, sanitizeFolderName } from '../../role/store'
import {
  getRoleMeta,
  invalidateRoleDirCache,
  logger,
  openRoleDb,
  setRoleMeta,
  sleepRoleDb,
} from './core'
import { indexMessage } from '../store/search'
import { syncRoleMemoryCountSummary, writeRoleSummaryCache } from '../store/roleState'

const LEGACY_ATTACHMENT_URL_RE = /opengal:\/\/attachments\/([^"/\s]+)/g

interface LegacyMessageRow {
  id: number
  role_id: string
  role: string
  content: string
  ts: number
  archived: number
  kind?: string
}

interface LegacyMemoryRow {
  id: string
  role_id: string
  kind?: string
  text: string
  entity?: string
  subject?: string | null
  attribute?: string | null
  object?: string | null
  polarity?: number | null
  confidence?: number
  source?: string
  state?: string
  importance?: number
  happened_at?: number | null
  created_at?: number | string
  confirmed_at?: number | null
  source_from?: number | null
  source_to?: number | null
  supersedes?: string | null
  pinned?: number
  reinforce?: number
  embedding?: string | null
  valid_from?: string | null
  invalid_at?: string | null
  due_at?: string | null
  frozen_at?: string | null
  evidence?: string | null
}

interface LegacySummaryRow {
  role_id: string
  start_ts: number
  end_ts: number
  text: string
  message_count: number
  created_at: number
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined
  return Boolean(row?.name)
}

function copyAndRewriteAttachments(
  dataRoot: string,
  roleDir: string,
  rawContent: string,
): string {
  const legacyAttachDir = path.join(dataRoot, 'attachments')
  const targetAttachDir = path.join(roleDir, 'attachments')
  return rawContent.replace(LEGACY_ATTACHMENT_URL_RE, (full, encodedName: string) => {
    try {
      const fileName = decodeURIComponent(encodedName)
      const src = path.join(legacyAttachDir, fileName)
      if (fs.existsSync(src)) {
        fs.mkdirSync(targetAttachDir, { recursive: true })
        const dst = path.join(targetAttachDir, fileName)
        if (!fs.existsSync(dst)) fs.copyFileSync(src, dst)
      }
      return `opengal://self-attachments/${encodedName}`
    } catch {
      return full
    }
  })
}

function ensureTargetRoleFolder(dataRoot: string, roleId: string, modRoot: string): boolean {
  const existing = findRoleFolderById(dataRoot, roleId)
  if (existing) return true

  const mods = listModsByCapability('role-template', modRoot)
  const matched = mods.find((m) => m.id === roleId || m.folderName === roleId)
  if (!matched) return false

  const preferredName = matched.displayName || matched.name || matched.folderName
  let folderName = sanitizeFolderName(preferredName) || sanitizeFolderName(roleId)
  let seq = 2
  while (fs.existsSync(path.join(dataRoot, 'roles', folderName))) {
    folderName = `${sanitizeFolderName(preferredName)} ${seq}`
    seq++
  }

  materializeRole(
    dataRoot,
    matched.rootPath,
    folderName,
    { id: matched.id, folder: matched.folderName, version: matched.version },
    { roleId },
  )
  invalidateRoleDirCache()
  return true
}

function collectLegacyRoleIds(db: DatabaseSync): string[] {
  const ids = new Set<string>()
  for (const table of ['messages', 'memories', 'summaries']) {
    if (!tableExists(db, table)) continue
    try {
      const rows = db.prepare(`SELECT DISTINCT role_id FROM ${table}`).all() as Array<{ role_id?: unknown }>
      for (const r of rows) {
        if (typeof r.role_id === 'string' && r.role_id.trim() && r.role_id !== '_system') {
          ids.add(r.role_id.trim())
        }
      }
    } catch {
      continue
    }
  }
  return [...ids]
}

/**
 * 将旧版全局 data/memory.db 只读导入到各角色独立的 data/roles/<角色>/memory.db。
 * 全程只读打开旧库、不删旧文件、幂等去重；若 data/roles 尚未实例化该角色且 mods/ 有同名模板，自动实例化后导入。
 */
export function importLegacyGlobalMemoryDb(
  dataRoot: string,
  modRoot = getModRoot(),
): { importedRoles: string[] } {
  const legacyFile = path.join(dataRoot, 'memory.db')
  if (!fs.existsSync(legacyFile)) return { importedRoles: [] }

  const importedRoles: string[] = []
  let legacyDb: DatabaseSync | null = null
  try {
    legacyDb = new DatabaseSync(legacyFile, { readOnly: true })
    const roleIds = collectLegacyRoleIds(legacyDb)
    if (roleIds.length === 0) return { importedRoles }

    const hasMessages = tableExists(legacyDb, 'messages')
    const hasMemories = tableExists(legacyDb, 'memories')
    const hasSources = tableExists(legacyDb, 'memory_sources')
    const hasSummaries = tableExists(legacyDb, 'summaries')

    for (const roleId of roleIds) {
      if (!ensureTargetRoleFolder(dataRoot, roleId, modRoot)) {
        logger.info('memory', `旧全局库角色 ${roleId} 未找到已建目录或匹配模板，暂保留在旧库备份中`)
        continue
      }

      if (getRoleMeta(roleId, 'legacy_global_imported')) {
        sleepRoleDb(roleId)
        continue
      }

      const handle = openRoleDb(roleId)
      const legacyIdToNewMsgId = new Map<number, number>()
      let importedMsgCount = 0
      let importedMemCount = 0

      handle.port.transaction(() => {
        if (hasMessages) {
          const msgs = legacyDb!
            .prepare('SELECT id, role_id, role, content, ts, archived, kind FROM messages WHERE role_id = ? ORDER BY ts, id')
            .all(roleId) as unknown as LegacyMessageRow[]
          for (const msg of msgs) {
            const clientId = `legacy-global-msg:${msg.id}`
            const rewritten = copyAndRewriteAttachments(dataRoot, handle.roleDir, msg.content)
            const info = handle.port.run(
              `INSERT OR IGNORE INTO messages(role, content, ts, archived, kind, client_id)
               VALUES(?, ?, ?, ?, ?, ?)`,
              [msg.role, rewritten, msg.ts, msg.archived ?? 0, msg.kind ?? 'chat', clientId],
            )
            if (info.changes > 0) {
              legacyIdToNewMsgId.set(msg.id, info.lastInsertRowid)
              if ((msg.archived ?? 0) < 2) {
                indexMessage(handle, info.lastInsertRowid, rewritten)
              }
              importedMsgCount++
            }
          }
        }

        if (hasMemories) {
          const mems = legacyDb!
            .prepare('SELECT * FROM memories WHERE role_id = ?')
            .all(roleId) as unknown as LegacyMemoryRow[]
          for (const m of mems) {
            const createdAt =
              typeof m.created_at === 'number'
                ? m.created_at
                : typeof m.created_at === 'string'
                  ? Date.parse(m.created_at) || Date.now()
                  : Date.now()
            const info = handle.port.run(
              `INSERT OR IGNORE INTO memories(
                id, kind, text, entity, subject, attribute, object, polarity,
                confidence, source, state, importance, happened_at, created_at,
                confirmed_at, source_from, source_to, supersedes, pinned,
                reinforce, embedding, valid_from, invalid_at, due_at, frozen_at, evidence
              ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                m.id,
                m.kind ?? 'fact',
                m.text,
                m.entity ?? 'user',
                m.subject ?? null,
                m.attribute ?? null,
                m.object ?? null,
                m.polarity ?? null,
                m.confidence ?? 0.8,
                m.source ?? 'llm_inferred',
                m.state ?? 'active',
                m.importance ?? 3,
                m.happened_at ?? null,
                createdAt,
                m.confirmed_at ?? null,
                m.source_from ?? null,
                m.source_to ?? null,
                m.supersedes ?? null,
                m.pinned ?? 0,
                m.reinforce ?? 0,
                m.embedding ?? null,
                m.valid_from ?? null,
                m.invalid_at ?? null,
                m.due_at ?? null,
                m.frozen_at ?? null,
                m.evidence ?? null,
              ],
            )
            if (info.changes > 0) importedMemCount++
          }
        }

        if (hasSources && legacyIdToNewMsgId.size > 0) {
          const sources = legacyDb!
            .prepare(
              `SELECT ms.memory_id, ms.message_id FROM memory_sources ms
               JOIN memories m ON m.id = ms.memory_id
               WHERE m.role_id = ?`,
            )
            .all(roleId) as Array<{ memory_id: string; message_id: number }>
          for (const src of sources) {
            const mappedMsgId = legacyIdToNewMsgId.get(src.message_id)
            if (mappedMsgId !== undefined) {
              handle.port.run(
                'INSERT OR IGNORE INTO memory_sources(memory_id, message_id) VALUES(?, ?)',
                [src.memory_id, mappedMsgId],
              )
            }
          }
        }

        if (hasSummaries) {
          const sums = legacyDb!
            .prepare('SELECT role_id, start_ts, end_ts, text, message_count, created_at FROM summaries WHERE role_id = ?')
            .all(roleId) as unknown as LegacySummaryRow[]
          for (const s of sums) {
            handle.port.run(
              'INSERT INTO summaries(start_ts, end_ts, text, message_count, created_at) VALUES(?, ?, ?, ?, ?)',
              [s.start_ts, s.end_ts, s.text, s.message_count ?? 0, s.created_at ?? Date.now()],
            )
          }
        }
      })

      setRoleMeta(roleId, 'legacy_global_imported', new Date().toISOString())
      syncRoleMemoryCountSummary(roleId)
      writeRoleSummaryCache(roleId, { lastActiveAt: Date.now() })
      sleepRoleDb(roleId)
      importedRoles.push(roleId)
      logger.info(
        'memory',
        `已从旧版全局库无损导入角色 ${roleId}：消息 ${importedMsgCount} 条，记忆 ${importedMemCount} 条`,
      )
    }
  } catch (err) {
    logger.warn('memory', `读取旧版全局记忆库失败（原文件已保留）: ${getErrorMessage(err)}`)
  } finally {
    try {
      legacyDb?.close()
    } catch {
      /* ignore */
    }
  }
  return { importedRoles }
}
