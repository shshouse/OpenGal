import { db, rows, run, withTx } from './core'
import { indexMessage, MESSAGE_COLUMNS } from './search'
import type { MemoryRow, MessageRow } from './types'

export function listUnarchivedMessages(characterId: string): MessageRow[] {
  return rows(
    'SELECT id, character_id, role, content, ts, archived FROM messages WHERE character_id = ? AND archived = 0 ORDER BY ts, id',
    [characterId]
  ) as unknown as MessageRow[]
}

export function replaceUnarchivedMessages(
  characterId: string,
  items: Array<Omit<MessageRow, 'id'> & { id?: number }>,
): void {
  withTx(() => {
    run('DELETE FROM messages WHERE character_id = ? AND archived = 0', [characterId])
    for (const item of items) {
      if (typeof item.id === 'number') {
        run(
          'INSERT OR REPLACE INTO messages(id, character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, ?, ?, ?)',
          [item.id, characterId, item.role, item.content, item.ts, item.archived, item.kind ?? 'chat']
        )
        indexMessage(item.id, item.content)
      } else {
        const info = db!
          .prepare('INSERT INTO messages(character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, ?, ?)')
          .run(characterId, item.role, item.content, item.ts, item.archived, item.kind ?? 'chat')
        indexMessage(Number(info.lastInsertRowid), item.content)
      }
    }
  })
}

export function appendMessage(item: Omit<MessageRow, 'id'>): void {
  withTx(() => {
    const info = db!
      .prepare('INSERT INTO messages(character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, ?, ?)')
      .run(item.character_id, item.role, item.content, item.ts, item.archived, item.kind ?? 'chat')
    indexMessage(Number(info.lastInsertRowid), item.content)
  })
}

// 旧会话导入只追加缺失项，不触碰现有消息；判重键与导入时生成的时间戳一致，重复导入幂等
export function appendMissingMessages(
  characterId: string,
  items: Array<Omit<MessageRow, 'id'>>,
): number {
  let inserted = 0
  withTx(() => {
    const exists = db!.prepare(
      'SELECT 1 FROM messages WHERE character_id = ? AND role = ? AND content = ? AND ts = ? LIMIT 1'
    )
    const insert = db!.prepare(
      'INSERT INTO messages(character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, ?, ?)'
    )
    for (const item of items) {
      if (exists.get(characterId, item.role, item.content, item.ts)) continue
      const info = insert.run(characterId, item.role, item.content, item.ts, item.archived, item.kind ?? 'chat')
      indexMessage(Number(info.lastInsertRowid), item.content)
      inserted++
    }
  })
  return inserted
}

export function memoryEvidence(characterId: string, memoryId: string, limit = 5): MessageRow[] {
  const found = rows('SELECT * FROM memories WHERE id = ? AND character_id = ?', [memoryId, characterId])
  if (found.length === 0) return []
  const row = found[0] as unknown as MemoryRow
  const evidence = row.evidence
    ? (JSON.parse(row.evidence) as { messageIds?: unknown })
    : null
  const ids = Array.isArray(evidence?.messageIds)
    ? evidence.messageIds.filter((id): id is number => typeof id === 'number').slice(0, limit)
    : []
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ')
    return rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND id IN (${placeholders}) ORDER BY ts, id`,
      [characterId, ...ids]
    ) as unknown as MessageRow[]
  }
  if (row.source_from !== null && row.source_to !== null) {
    return rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND ts >= ? AND ts <= ? ORDER BY ts, id LIMIT ?`,
      [characterId, row.source_from, row.source_to, limit]
    ) as unknown as MessageRow[]
  }
  return []
}

// 按时间范围取原话，用于从记忆回溯到当天的对话
export function messagesInRange(characterId: string, fromTs: number, toTs: number): MessageRow[] {
  return rows(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND ts >= ? AND ts <= ? ORDER BY ts, id`,
    [characterId, fromTs, toTs]
  ) as unknown as MessageRow[]
}

// 批量追加聊天消息（单事务），content 为完整消息对象 JSON
export function saveChatMessages(characterId: string, items: Array<{ role: string }>): number[] {
  if (items.length === 0) return []
  const base = Date.now()
  const ids: number[] = []
  withTx(() => {
    for (let i = 0; i < items.length; i++) {
      const info = db!
        .prepare('INSERT INTO messages(character_id, role, content, ts, archived, kind) VALUES(?, ?, ?, ?, 0, ?)')
        .run(characterId, items[i].role, JSON.stringify(items[i]), base + i, 'chat')
      ids.push(Number(info.lastInsertRowid))
      indexMessage(Number(info.lastInsertRowid), JSON.stringify(items[i]))
    }
  })
  return ids
}

// 锚点归档：把 [fromId..toId] 区间内的未归档消息标记 archived（原文保留）
export function archiveMessagesRange(characterId: string, fromId: number, toId: number): number {
  return withTx(() => {
    const info = db!.prepare(
      'UPDATE messages SET archived = 1 WHERE character_id = ? AND archived = 0 AND id >= ? AND id <= ?'
    ).run(characterId, fromId, toId)
    return Number(info.changes)
  })
}

// 摘要与归档必须同一个事务：先归档，归档 0 行说明区间已处理过，不能再插摘要
export function commitCompression(
  characterId: string,
  fromId: number,
  toId: number,
  summary: { text: string; message_count: number; start_ts: number; end_ts: number },
): { archived: number } {
  return withTx(() => {
    const info = db!.prepare(
      'UPDATE messages SET archived = 1 WHERE character_id = ? AND archived = 0 AND id >= ? AND id <= ?'
    ).run(characterId, fromId, toId)
    const archived = Number(info.changes)
    if (archived === 0) return { archived }
    db!.prepare(
      'INSERT INTO summaries(character_id, start_ts, end_ts, text, message_count, created_at) VALUES(?, ?, ?, ?, ?, ?)'
    ).run(characterId, summary.start_ts, summary.end_ts, summary.text, summary.message_count, Date.now())
    return { archived }
  })
}

// 取未归档消息的最新 id，作为下一次归档的锚点
export function latestMessageId(characterId: string): number | null {
  const found = rows('SELECT MAX(id) AS m FROM messages WHERE character_id = ? AND archived = 0', [characterId])
  const v = found[0]?.m
  return typeof v === 'number' ? v : null
}

export function clearCharacterMessages(characterId: string): void {
  withTx(() => {
    run('UPDATE messages SET archived = 1 WHERE character_id = ?', [characterId])
  })
}
