import fs from 'node:fs'
import path from 'node:path'
import { getMeta, logger, setMeta, withTx } from './core'
import { insertMemoryRowRaw, isoToMs } from './memoryRows'
import { appendMissingMessages } from './messages'

// ---- 旧 JSON 记忆一次性迁移（JSON 原地保留，只读） ----

interface LegacyFactJson {
  id?: unknown
  text?: unknown
  entity?: unknown
  importance?: unknown
  confidence?: unknown
  source?: unknown
  created_at?: unknown
  last_confirmed_at?: unknown
  status?: unknown
  evidence?: { reinforce?: unknown; negate?: unknown }
}

interface LegacyStoryJson {
  id?: unknown
  kind?: unknown
  text?: unknown
  occurred_at?: unknown
  due_at?: unknown
  fulfilled?: unknown
  importance?: unknown
  status?: unknown
  created_at?: unknown
}

function intOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

function readJsonArray(file: string): unknown[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function syncLegacyMemoryFromJson(dataRoot: string): void {
  try {
    const root = path.join(dataRoot, 'memory')
    if (!fs.existsSync(root)) return
    for (const dirName of fs.readdirSync(root)) {
      const charDir = path.join(root, dirName)
      if (!fs.statSync(charDir).isDirectory()) continue
      const factsFile = path.join(charDir, 'facts.json')
      const storyFile = path.join(charDir, 'story.json')
      if (!fs.existsSync(factsFile) && !fs.existsSync(storyFile)) continue
      const marker = `legacy_mem:${dirName}`
      if (getMeta(marker)) continue
      const now = new Date().toISOString()
      let factCount = 0
      let storyCount = 0
      withTx(() => {
        for (const raw of readJsonArray(factsFile)) {
          const f = raw as LegacyFactJson
          if (typeof f.id !== 'string' || typeof f.text !== 'string' || !f.text) continue
          insertMemoryRowRaw(dirName, {
            id: f.id,
            character_id: dirName,
            kind: 'fact',
            text: f.text,
            entity: typeof f.entity === 'string' ? f.entity : 'user',
            importance: intOr(f.importance, 5),
            confidence: Number.isFinite(Number(f.confidence)) ? Number(f.confidence) : 0.5,
            source: typeof f.source === 'string' ? f.source : 'llm_inferred',
            state: f.status === 'active' ? 'active' : 'archived',
            happened_at: null,
            created_at: isoToMs(typeof f.created_at === 'string' ? f.created_at : now),
            confirmed_at: isoToMs(typeof f.last_confirmed_at === 'string' ? f.last_confirmed_at : now),
            source_from: null,
            source_to: null,
            supersedes: null,
            pinned: f.source === 'manual' ? 1 : 0,
            embedding: null,
          })
          factCount++
        }
        for (const raw of readJsonArray(storyFile)) {
          const s = raw as LegacyStoryJson
          if (typeof s.id !== 'string' || typeof s.text !== 'string' || !s.text) continue
          insertMemoryRowRaw(dirName, {
            id: s.id,
            character_id: dirName,
            kind: typeof s.kind === 'string' ? s.kind : 'event',
            text: s.text,
            state: s.fulfilled ? 'fulfilled' : (s.status === 'active' ? 'active' : 'archived'),
            importance: intOr(s.importance, 5),
            happened_at: isoToMs(typeof s.occurred_at === 'string' ? s.occurred_at : now),
            created_at: isoToMs(typeof s.created_at === 'string' ? s.created_at : now),
            source_from: null,
            source_to: null,
            supersedes: null,
            pinned: 0,
            embedding: null,
            due_at: typeof s.due_at === 'string' ? s.due_at : null,
          })
          storyCount++
        }
        setMeta(marker, now)
      })
      if (factCount > 0 || storyCount > 0) {
        logger.info('memory', `已迁移旧记忆: ${dirName}（facts ${factCount} 条, stories ${storyCount} 条），原 JSON 保留未动`)
      }
    }
  } catch (err) {
    logger.warn('memory', `旧记忆迁移失败（原文件未动，下次启动重试）: ${(err as Error).message}`)
  }
}

// ---- chat_history JSON 同步（只读导入，JSON 保持原位） ----

interface LegacyChatFile {
  version?: number
  characterId?: string
  messages?: Array<{ role: string; content: unknown }>
}

export async function syncChatHistoryFromJson(dataRoot: string): Promise<void> {
  try {
    const dir = path.join(dataRoot, 'chat_history')
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const file = path.join(dir, name)
      const mtime = String(Math.floor(fs.statSync(file).mtimeMs))
      const safeName = name.slice(0, -'.json'.length)
      if (getMeta(`chat_mtime:${safeName}`) === mtime) continue
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as LegacyChatFile
      const characterId = parsed?.characterId || safeName
      const msgs = Array.isArray(parsed?.messages) ? parsed.messages : []
      const mtimeMs = fs.statSync(file).mtimeMs
      const items = msgs.map((m, i) => ({
        character_id: characterId,
        role: m.role,
        content: JSON.stringify(m),
        ts: Math.max(0, Math.round(mtimeMs - (msgs.length - 1 - i) * 1000)),
        archived: 0,
      }))
      appendMissingMessages(characterId, items)
      setMeta(`chat_mtime:${safeName}`, mtime)
      logger.info('memory', `已同步会话历史到记忆库: ${characterId}（${items.length} 条）`)
    }
  } catch (err) {
    logger.warn('memory', `会话历史同步失败（原文件未动）: ${(err as Error).message}`)
  }
}
