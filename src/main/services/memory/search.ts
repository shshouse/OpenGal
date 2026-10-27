import type { MessageRow, MessageSearchOptions } from './types'
import { rows, run } from './core'

const CJK_RE = /[㐀-鿿豈-﫿]/

/** 中文按相邻双字切词、英文与数字按整词；写入与查询必须使用同一套规则。 */
export function searchTokens(text: string): string[] {
  const parts = text.match(/[㐀-鿿豈-﫿]+|[A-Za-z0-9]+/g) ?? []
  const tokens: string[] = []
  for (const part of parts) {
    if (CJK_RE.test(part)) {
      if (part.length === 1) tokens.push(part)
      for (let i = 0; i + 1 < part.length; i++) tokens.push(part.slice(i, i + 2))
    } else {
      tokens.push(part.toLowerCase())
    }
  }
  return [...new Set(tokens)]
}

/** 消息 content 可能是完整消息 JSON，也可能是不带 JSON 的旧裸文本。 */
export function visibleMessageText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') return parsed
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw
    const content = (parsed as { content?: unknown }).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== 'object') return ''
          if ('text' in part) return String(part.text)
          if ('image_url' in part) return '[图片]'
          return ''
        })
        .filter(Boolean)
        .join(' ')
    }
    return raw
  } catch {
    return raw
  }
}

export function indexMessage(id: number, content: string): void {
  run('DELETE FROM messages_fts WHERE rowid = ?', [id])
  run('INSERT INTO messages_fts(rowid, message_id, tokens) VALUES(?, ?, ?)', [
    id,
    id,
    searchTokens(visibleMessageText(content)).join(' '),
  ])
}

export const MESSAGE_COLUMNS = 'id, character_id, role, content, ts, archived, kind'

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

function searchMessagesInternal(
  characterId: string,
  query: string,
  limit: number,
  radius: number,
  fromTs?: number,
  toTs?: number,
): MessageRow[] {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const range = fromTs !== undefined && toTs !== undefined
  const rangeParams = range ? [fromTs as number, toTs as number] : []
  const hits: MessageRow[] = []

  const tokens = searchTokens(query)
  if (tokens.length > 0) {
    const match = tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ')
    const found = rows(
      `SELECT m.id, m.character_id, m.role, m.content, m.ts, m.archived, m.kind
       FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ? AND m.character_id = ?${range ? ' AND m.ts >= ? AND m.ts <= ?' : ''}
       ORDER BY bm25(messages_fts) LIMIT ?`,
      [match, characterId, ...rangeParams, limit]
    ) as unknown as MessageRow[]
    for (const row of found) {
      if (terms.every((term) => visibleMessageText(String(row.content)).includes(term))) hits.push(row)
    }
  }

  // 单字与短词不会被相邻双字索引覆盖，用子串兜底
  if (hits.length === 0) {
    const where = terms.map(() => "content LIKE ? ESCAPE '\\'").join(' AND ')
    const fallback = rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND ${where}${range ? ' AND ts >= ? AND ts <= ?' : ''} ORDER BY ts DESC, id DESC LIMIT ?`,
      [characterId, ...terms.map(likePattern), ...rangeParams, limit]
    ) as unknown as MessageRow[]
    hits.push(...fallback)
  }

  return expandNeighbors(characterId, hits, radius, fromTs, toTs)
}

function expandNeighbors(
  characterId: string,
  hits: MessageRow[],
  radius: number,
  fromTs?: number,
  toTs?: number,
): MessageRow[] {
  const range = fromTs !== undefined && toTs !== undefined
  const rangeSql = range ? ' AND ts >= ? AND ts <= ?' : ''
  const rangeParams = range ? [fromTs as number, toTs as number] : []
  const found = new Map<number, MessageRow>()
  for (const hit of hits) {
    const id = hit.id as number
    found.set(id, hit)
    if (radius <= 0) continue
    const before = rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND id < ?${rangeSql} ORDER BY id DESC LIMIT ?`,
      [characterId, id, ...rangeParams, radius]
    ) as unknown as MessageRow[]
    const after = rows(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE character_id = ? AND id > ?${rangeSql} ORDER BY id ASC LIMIT ?`,
      [characterId, id, ...rangeParams, radius]
    ) as unknown as MessageRow[]
    for (const row of [...before, ...after]) found.set(row.id as number, row)
  }
  return [...found.values()].sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0))
}


/** 中文原文检索：先走相邻双字索引，未命中再退回子串；结果含相邻上下文。 */
export function searchMessages(
  characterId: string,
  query: string,
  opts: MessageSearchOptions = {},
): MessageRow[] {
  return searchMessagesInternal(characterId, query, opts.limit ?? 3, opts.radius ?? 1, opts.fromTs, opts.toTs)
}
