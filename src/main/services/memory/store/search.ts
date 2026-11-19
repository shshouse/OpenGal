import type { MessageRow, MessageSearchOptions } from '../model/types'
import { openRoleDb, type RoleDbHandle } from '../db/core'

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/

export function searchTokens(text: string): string[] {
  const parts = text.match(/[\u3400-\u9fff\uf900-\ufaff]+|[A-Za-z0-9]+/g) ?? []
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

export function indexMessage(handle: RoleDbHandle, id: number, content: string): void {
  handle.port.run('DELETE FROM messages_fts WHERE rowid = ?', [id])
  handle.port.run('INSERT INTO messages_fts(rowid, message_id, tokens) VALUES(?, ?, ?)', [
    id,
    id,
    searchTokens(visibleMessageText(content)).join(' '),
  ])
}

export const MESSAGE_COLUMNS = 'id, role, content, ts, archived, kind'

interface RawMessageRow {
  id: number
  role: string
  content: string
  ts: number
  archived: number
  kind?: string
}

export function toMessageRow(roleId: string, row: RawMessageRow): MessageRow {
  return {
    id: row.id,
    role_id: roleId,
    role: row.role,
    content: row.content,
    ts: row.ts,
    archived: row.archived,
    ...(row.kind !== undefined ? { kind: row.kind } : {}),
  }
}

function escapeLike(term: string): string {
  const out: string[] = ['%']
  for (const ch of term) {
    if (ch === '%' || ch === '_' || ch === '!') out.push('!', ch)
    else out.push(ch)
  }
  out.push('%')
  return out.join('')
}

function expandNeighbors(
  handle: RoleDbHandle,
  roleId: string,
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
    const before = handle.port
      .query<RawMessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id < ?${rangeSql} ORDER BY id DESC LIMIT ?`,
        [id, ...rangeParams, radius],
      )
      .map((r) => toMessageRow(roleId, r))
    const after = handle.port
      .query<RawMessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id > ?${rangeSql} ORDER BY id ASC LIMIT ?`,
        [id, ...rangeParams, radius],
      )
      .map((r) => toMessageRow(roleId, r))
    for (const row of [...before, ...after]) found.set(row.id as number, row)
  }
  return [...found.values()].sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0))
}

export function searchMessages(
  roleId: string,
  query: string,
  opts: MessageSearchOptions = {},
): MessageRow[] {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const handle = openRoleDb(roleId)
  const limit = opts.limit ?? 3
  const radius = opts.radius ?? 1
  const range = opts.fromTs !== undefined && opts.toTs !== undefined
  const rangeParams = range ? [opts.fromTs as number, opts.toTs as number] : []
  const hits: MessageRow[] = []

  const tokens = searchTokens(query)
  if (tokens.length > 0) {
    const match = tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ')
    const found = handle.port.query<RawMessageRow>(
      `SELECT m.id, m.role, m.content, m.ts, m.archived, m.kind
       FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ?${range ? ' AND m.ts >= ? AND m.ts <= ?' : ''}
       ORDER BY bm25(messages_fts) LIMIT ?`,
      [match, ...rangeParams, limit],
    )
    for (const row of found) {
      if (terms.every((term) => visibleMessageText(String(row.content)).includes(term))) {
        hits.push(toMessageRow(roleId, row))
      }
    }
  }

  if (hits.length === 0) {
    const where = terms.map(() => "content LIKE ? ESCAPE '!'").join(' AND ')
    const fallback = handle.port
      .query<RawMessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${where}${range ? ' AND ts >= ? AND ts <= ?' : ''} ORDER BY ts DESC, id DESC LIMIT ?`,
        [...terms.map(escapeLike), ...rangeParams, limit],
      )
      .map((r) => toMessageRow(roleId, r))
    hits.push(...fallback)
  }

  return expandNeighbors(handle, roleId, hits, radius, opts.fromTs, opts.toTs)
}
