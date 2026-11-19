import { openRoleDb } from '../db/core'
import { indexMessage, MESSAGE_COLUMNS, toMessageRow, visibleMessageText } from './search'
import { writeRoleSummaryCache } from './roleState'
import type { MemoryRow, MessageRow } from '../model/types'

interface RawMsg {
  id: number
  role: string
  content: string
  ts: number
  archived: number
  kind?: string
  client_id?: string | null
  translation?: string | null
  translation_lang?: string | null
}

export function listUnarchivedMessages(roleId: string): MessageRow[] {
  const handle = openRoleDb(roleId)
  return handle.port
    .query<RawMsg>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE archived = 0 ORDER BY ts, id`,
    )
    .map((row) => toMessageRow(roleId, row))
}

export function replaceUnarchivedMessages(
  roleId: string,
  items: Array<Omit<MessageRow, 'id'> & { id?: number }>,
): void {
  const handle = openRoleDb(roleId)
  handle.port.transaction(() => {
    handle.port.run('DELETE FROM messages WHERE archived = 0')
    for (const item of items) {
      if (typeof item.id === 'number') {
        handle.port.run(
          `INSERT OR REPLACE INTO messages(id, role, content, ts, archived, kind, client_id, translation, translation_lang)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            item.role,
            item.content,
            item.ts,
            item.archived,
            item.kind ?? 'chat',
            item.client_id ?? null,
            item.translation ?? null,
            item.translation_lang ?? null,
          ],
        )
        indexMessage(handle, item.id, item.content)
      } else {
        const info = handle.port.run(
          `INSERT OR IGNORE INTO messages(role, content, ts, archived, kind, client_id, translation, translation_lang)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.role,
            item.content,
            item.ts,
            item.archived,
            item.kind ?? 'chat',
            item.client_id ?? null,
            item.translation ?? null,
            item.translation_lang ?? null,
          ],
        )
        if (info.changes > 0) indexMessage(handle, info.lastInsertRowid, item.content)
      }
    }
  })
}

export function appendMessage(item: Omit<MessageRow, 'id'>): void {
  const handle = openRoleDb(item.role_id)
  handle.port.transaction(() => {
    const info = handle.port.run(
      `INSERT OR IGNORE INTO messages(role, content, ts, archived, kind, client_id, translation, translation_lang)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.role,
        item.content,
        item.ts,
        item.archived,
        item.kind ?? 'chat',
        item.client_id ?? null,
        item.translation ?? null,
        item.translation_lang ?? null,
      ],
    )
    if (info.changes > 0) indexMessage(handle, info.lastInsertRowid, item.content)
  })
}

export function appendMissingMessages(
  roleId: string,
  items: Array<Omit<MessageRow, 'id'>>,
): number {
  const handle = openRoleDb(roleId)
  let inserted = 0
  handle.port.transaction(() => {
    for (const item of items) {
      if (item.client_id) {
        const byKey = handle.port.query(
          'SELECT 1 FROM messages WHERE client_id = ? LIMIT 1',
          [item.client_id],
        )
        if (byKey.length > 0) continue
      }
      const exists = handle.port.query(
        'SELECT 1 FROM messages WHERE role = ? AND content = ? AND ts = ? LIMIT 1',
        [item.role, item.content, item.ts],
      )
      if (exists.length > 0) continue
      const info = handle.port.run(
        `INSERT OR IGNORE INTO messages(role, content, ts, archived, kind, client_id, translation, translation_lang)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.role,
          item.content,
          item.ts,
          item.archived,
          item.kind ?? 'chat',
          item.client_id ?? null,
          item.translation ?? null,
          item.translation_lang ?? null,
        ],
      )
      if (info.changes > 0) {
        indexMessage(handle, info.lastInsertRowid, item.content)
        inserted++
      }
    }
  })
  return inserted
}

export function memoryEvidence(roleId: string, memoryId: string, limit = 5): MessageRow[] {
  const handle = openRoleDb(roleId)
  const found = handle.port.query<MemoryRow>('SELECT * FROM memories WHERE id = ?', [memoryId])
  const row = found[0]
  if (!row) return []

  const linked = handle.port
    .query<{ message_id: number }>(
      'SELECT message_id FROM memory_sources WHERE memory_id = ? ORDER BY message_id LIMIT ?',
      [memoryId, limit],
    )
    .map((item) => Number(item.message_id))
  const evidence = row.evidence ? (JSON.parse(row.evidence) as { messageIds?: unknown }) : null
  const ids =
    linked.length > 0
      ? linked
      : Array.isArray(evidence?.messageIds)
        ? evidence.messageIds.filter((id): id is number => typeof id === 'number').slice(0, limit)
        : []
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ')
    return handle.port
      .query<RawMsg>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id IN (${placeholders}) ORDER BY ts, id`,
        ids,
      )
      .map((r) => toMessageRow(roleId, r))
  }
  if (row.source_from !== null && row.source_to !== null) {
    return handle.port
      .query<RawMsg>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE archived < 2 AND ts >= ? AND ts <= ? ORDER BY ts, id LIMIT ?`,
        [row.source_from, row.source_to, limit],
      )
      .map((r) => toMessageRow(roleId, r))
  }
  return []
}

export function messagesInRange(
  roleId: string,
  fromTs: number,
  toTs: number,
  limit = 6,
): MessageRow[] {
  const handle = openRoleDb(roleId)
  return handle.port
    .query<RawMsg>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE archived < 2 AND ts >= ? AND ts <= ? ORDER BY ts, id LIMIT ?`,
      [fromTs, toTs, limit],
    )
    .map((r) => toMessageRow(roleId, r))
}

export function saveChatMessages(
  roleId: string,
  items: Array<{
    role: string
    ts?: number
    clientId?: string
    translation?: string
    translationLang?: string
    [key: string]: unknown
  }>,
): number[] {
  const handle = openRoleDb(roleId)
  const base = Date.now()
  const ids: number[] = []
  let lastPreview = ''

  handle.port.transaction(() => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item) continue
      const ts = typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : base + i
      const clientId = typeof item.clientId === 'string' && item.clientId.trim() ? item.clientId.trim() : null
      const translation = typeof item.translation === 'string' && item.translation.trim() ? item.translation.trim() : null
      const translationLang =
        typeof item.translationLang === 'string' && item.translationLang.trim()
          ? item.translationLang.trim()
          : null

      const json = JSON.stringify(item)
      const info = handle.port.run(
        `INSERT OR IGNORE INTO messages(role, content, ts, archived, kind, client_id, translation, translation_lang)
         VALUES(?, ?, ?, 0, 'chat', ?, ?, ?)`,
        [item.role, json, ts, clientId, translation, translationLang],
      )
      if (info.changes > 0) {
        ids.push(info.lastInsertRowid)
        indexMessage(handle, info.lastInsertRowid, json)
      } else if (clientId) {
        const existing = handle.port.query<{ id: number }>(
          'SELECT id FROM messages WHERE client_id = ? LIMIT 1',
          [clientId],
        )[0]
        if (existing) ids.push(Number(existing.id))
      }

      const visible = visibleMessageText(json).trim()
      if (visible) lastPreview = visible.slice(0, 80)
    }
  })

  if (lastPreview) {
    writeRoleSummaryCache(roleId, {
      lastActiveAt: base + items.length,
      lastMessagePreview: lastPreview,
    })
  }
  return ids
}

export function updateMessageTranslation(
  roleId: string,
  match: { dbId?: number; clientId?: string },
  translation: string,
  translationLang: string,
): boolean {
  const cleanText = translation.trim()
  const cleanLang = translationLang.trim()
  if (!cleanText) return false
  const handle = openRoleDb(roleId)
  if (typeof match.dbId === 'number') {
    const info = handle.port.run(
      'UPDATE messages SET translation = ?, translation_lang = ? WHERE id = ?',
      [cleanText, cleanLang, match.dbId],
    )
    return info.changes > 0
  }
  if (match.clientId?.trim()) {
    const info = handle.port.run(
      'UPDATE messages SET translation = ?, translation_lang = ? WHERE client_id = ?',
      [cleanText, cleanLang, match.clientId.trim()],
    )
    return info.changes > 0
  }
  return false
}

export function archiveMessagesRange(roleId: string, fromId: number, toId: number): number {
  const handle = openRoleDb(roleId)
  return handle.port.transaction(
    () =>
      handle.port.run(
        'UPDATE messages SET archived = 1 WHERE archived = 0 AND id >= ? AND id <= ?',
        [fromId, toId],
      ).changes,
  )
}

export function commitCompression(
  roleId: string,
  fromId: number,
  toId: number,
  summary: { text: string; message_count: number; start_ts: number; end_ts: number },
): { archived: number } {
  const handle = openRoleDb(roleId)
  return handle.port.transaction(() => {
    const archived = handle.port.run(
      'UPDATE messages SET archived = 1 WHERE archived = 0 AND id >= ? AND id <= ?',
      [fromId, toId],
    ).changes
    if (archived === 0) return { archived }
    handle.port.run(
      'INSERT INTO summaries(start_ts, end_ts, text, message_count, created_at) VALUES(?, ?, ?, ?, ?)',
      [summary.start_ts, summary.end_ts, summary.text, summary.message_count, Date.now()],
    )
    return { archived }
  })
}

export function latestMessageId(roleId: string): number | null {
  const found = openRoleDb(roleId).port.query<{ m: number | null }>(
    'SELECT MAX(id) AS m FROM messages WHERE archived = 0',
  )
  const v = found[0]?.m
  return typeof v === 'number' ? v : null
}

/** 显式清空对话：标记 archived = 2 并从 FTS 索引中移除，避免检索命中已清空的对话（与 archived = 1 的压缩归档区分） */
export function clearRoleMessages(roleId: string): void {
  const handle = openRoleDb(roleId)
  handle.port.transaction(() => {
    handle.port.run('UPDATE messages SET archived = 2 WHERE archived = 0')
    handle.port.run('DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE archived = 2)')
  })
  writeRoleSummaryCache(roleId, { lastMessagePreview: '' })
}
