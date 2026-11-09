import type { MemoryConfig, MemoryFact, MemoryStory } from '@shared/types'
import { getMeta, memoryDbReady } from './core'
import { initMemoryDb } from '../memoryDb'
import {
  isCursorInitialized,
  listMessagesAfter,
  markCursorInitialized,
  bootstrapCursor,
  resetDerived,
  setMemoryCursor,
} from './memories'
import { memoryEvidence } from './messages'
import { searchMessages, visibleMessageText } from './search'
import { listMemories, clearMemories } from './store'
import { relevanceScore } from './lexical'
import { similarity, normalizeText, retentionOf } from './model'
import { assembleBlock } from './recall'
import { searchSimilarAsync } from './vector'
import { assembleWithVectors, buildMemoryBlock, buildMemoryBlockVector, toFactView, toStoryView } from './project'
import { applyCandidates, deleteFact, freezeFact, manualAddFact, pruneOverflow, unfreezeFact } from './write'

export { applyCandidates, deleteFact, freezeFact, manualAddFact, pruneOverflow, unfreezeFact }
export { buildMemoryBlock, buildMemoryBlockVector }
export { listMemories, normalizeText, relevanceScore }
export { similarity as textSimilarity }

let config: MemoryConfig = {
  injectCharCap: 900,
  batchTurns: 8,
  idleMinutes: 5,
  fallbackHours: 12,
}

export function initMemoryStore(root: string, cfg?: Partial<MemoryConfig>, backupRoot?: string): void {
  if (cfg) config = { ...config, ...cfg }
  void initMemoryDb(root, backupRoot).catch(() => {})
}

export async function loadFacts(roleId: string): Promise<MemoryFact[]> {
  await memoryDbReady()
  return listMemories(roleId).filter((memory) => memory.kind === 'fact').map(toFactView)
}

export async function loadStories(roleId: string): Promise<MemoryStory[]> {
  await memoryDbReady()
  return listMemories(roleId).filter((memory) => memory.kind === 'episode').map(toStoryView)
}

export async function clearMemory(roleId: string): Promise<void> {
  await memoryDbReady()
  clearMemories(roleId)
}

/** 新鲜度：留给界面和测试的兼容导出。 */
export function retentionScore(fact: {
  frozen_at?: string | null
  valid_until?: string | null
  last_confirmed_at?: string | null
  created_at?: string | null
  importance?: number
}): number {
  return retentionOf(fact)
}

export async function getMemoryBlock(
  roleId: string,
  context?: string,
  useVector = false,
  charCap = config.injectCharCap,
): Promise<string | null> {
  await memoryDbReady()
  const memories = listMemories(roleId)
  if (useVector && context) return assembleWithVectors(roleId, memories, context, charCap)
  return assembleBlock(memories, context ?? null, {
    charCap,
    relevance: context ? (memory) => relevanceScore(memory.text, context) : undefined,
  })
}

function formatMessageTime(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 原话召回：补充 facts/episodes 覆盖不到的逐字历史，带时间戳，供模型区分"当年说的"和"刚说的"
// 词法没命中时退回记忆向量：命中的事实再展开成当时的原话
async function recallFromMemoryVectors(roleId: string, query: string, charCap: number): Promise<string | null> {
  const facts = listMemories(roleId).filter((memory) => memory.kind === 'fact' && memory.state === 'active')
  if (facts.length === 0) return null
  let hits: Array<{ id: string, similarity: number }>
  try {
    hits = await searchSimilarAsync(facts, query, 3, 0.35)
  } catch {
    return null
  }
  if (hits.length === 0) return null
  const lines: string[] = []
  let used = 0
  for (const hit of hits) {
    for (const row of memoryEvidence(roleId, hit.id, 2)) {
      const text = visibleMessageText(row.content).trim()
      if (!text) continue
      const line = `[${formatMessageTime(row.ts)}] ${row.role}: ${text}`
      if (used + line.length > charCap) break
      lines.push(line)
      used += line.length
    }
  }
  if (lines.length === 0) {
    return hits.map((hit) => `[记忆] ${facts.find((fact) => fact.id === hit.id)?.text ?? ''}`).join('\n')
  }
  return `相关历史原话（按时间排列）：\n${lines.join('\n')}`
}

export async function recallVerbatim(
  roleId: string,
  query: string,
  charCap = 1500,
  range?: { fromTs: number, toTs: number },
): Promise<string | null> {
  if (!query.trim()) return null
  await memoryDbReady()
  const rows = searchMessages(roleId, query, { fromTs: range?.fromTs, toTs: range?.toTs, radius: 1 })
  if (rows.length === 0) return recallFromMemoryVectors(roleId, query, charCap)
  const lines: string[] = []
  let used = 0
  for (const row of rows) {
    const text = visibleMessageText(row.content).trim()
    if (!text) continue
    const line = `[${formatMessageTime(row.ts)}] ${row.role}: ${text}`
    if (used + line.length > charCap) break
    lines.push(line)
    used += line.length
  }
  return lines.length > 0 ? `相关历史原话（按时间排列）：\n${lines.join('\n')}` : null
}

const BOOTSTRAP_LOOKBACK = 200

export interface PendingEntry {
  role: 'user' | 'assistant'
  text: string
  at: number
}

// 启动时把库里还没提取的原文带回内存缓冲：崩溃/退出的会话也能补记
export async function pendingFromArchive(
  roleId: string,
  limit = 200,
): Promise<{ cursor: number, entries: PendingEntry[] }> {
  await memoryDbReady()
  let cursor = Number(getMeta(`memory.cursor.${roleId}`) ?? 0)
  if (!isCursorInitialized(roleId)) {
    cursor = bootstrapCursor(roleId, BOOTSTRAP_LOOKBACK)
    setMemoryCursor(roleId, cursor)
    markCursorInitialized(roleId)
  }
  const entries: PendingEntry[] = []
  for (const row of listMessagesAfter(roleId, cursor, limit)) {
    const text = visibleMessageText(row.content).trim()
    if (!text) continue
    const role: PendingEntry['role'] = row.role === 'user' ? 'user' : 'assistant'
    entries.push({ role, text: text.slice(0, role === 'user' ? 500 : 300), at: row.ts })
  }
  return { cursor, entries }
}

export async function advanceCursor(roleId: string, ts: number): Promise<void> {
  await memoryDbReady()
  const current = Number(getMeta(`memory.cursor.${roleId}`) ?? 0)
  if (ts > current) setMemoryCursor(roleId, ts)
  markCursorInitialized(roleId)
}

// 清空派生数据并从零重放；原文与聊天记录一条不动。必须显式传确认标记
export async function rebuildMemory(
  roleId: string,
  confirm: string,
): Promise<{ facts: number, stories: number }> {
  if (confirm !== `rebuild:${roleId}`) throw new Error(`重建需要确认标记 rebuild:${roleId}`)
  await memoryDbReady()
  const removed = resetDerived(roleId)
  setMemoryCursor(roleId, 0)
  markCursorInitialized(roleId)
  return removed
}
