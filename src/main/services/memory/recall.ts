import { isExpired, normalizeText, resolveCurrent, wantsHistory, type Memory } from './model'
import { scoreMemory } from './score'

export interface RecallOptions {
  charCap: number
  now?: number
  /** 相关性由调用方提供（向量或词面），缺省视为全部同等相关。 */
  relevance?: (memory: Memory) => number
}

interface Scored {
  memory: Memory
  text: string
  score: number
}

interface Buckets {
  user: Scored[]
  character: Scored[]
  relationship: Scored[]
  past: Memory[]
}

interface Budget {
  used: number
  cap: number
}

const GROUP_LABELS = {
  user: '关于他',
  character: '关于你自己',
  relationship: '关于你们',
} as const

function compare(a: Scored, b: Scored): number {
  return b.score - a.score
    || b.memory.importance - a.memory.importance
    || b.memory.createdAt - a.memory.createdAt
    || a.memory.id.localeCompare(b.memory.id)
}

function shortText(memory: Memory): string {
  return memory.text.slice(0, 60)
}

function uniqueHistory(history: Memory[]): Memory[] {
  const seen = new Set<string>()
  return [...history]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((memory) => {
      const key = normalizeText(memory.text)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function promiseLine(item: Scored): Scored {
  const { dueAt } = item.memory
  const due = dueAt && !Number.isNaN(Date.parse(dueAt)) ? `（约 ${dueAt.slice(0, 10)}）` : ''
  return { ...item, text: `约定：${item.text}${due}（还没兑现）` }
}

function bucketMemories(
  memories: Memory[],
  query: string | null,
  now: number,
  relevance: (memory: Memory) => number,
): Buckets {
  const states = resolveCurrent(memories)
  const groups: Record<'user' | 'character' | 'relationship', Scored[]> = {
    user: [],
    character: [],
    relationship: [],
  }
  const promises: Scored[] = []
  const episodes: Scored[] = []

  for (const memory of states.flatMap((state) => state.current)) {
    const item = { memory, text: shortText(memory), score: scoreMemory(memory, relevance(memory), now) }
    if (memory.kind === 'fact') groups[memory.entity].push(item)
    else if (memory.dueAt) promises.push(item)
    else episodes.push(item)
  }

  return {
    user: groups.user.sort(compare),
    character: groups.character.sort(compare),
    relationship: [
      ...promises.sort(compare).map(promiseLine),
      ...groups.relationship.sort(compare),
      ...episodes.sort(compare),
    ],
    past: wantsHistory(query)
      ? uniqueHistory(states.flatMap((state) => state.history)).slice(0, 5)
      : [],
  }
}

function takeWithin(items: Scored[], budget: Budget): string[] {
  const kept: string[] = []
  for (const item of items) {
    if (budget.used + item.text.length > budget.cap) break
    budget.used += item.text.length
    kept.push(item.text)
  }
  return kept
}

function takeHistory(past: Memory[], budget: Budget): string[] {
  const kept: string[] = []
  for (const memory of past) {
    const text = shortText(memory)
    if (budget.used + text.length > budget.cap) break
    budget.used += text.length
    kept.push(text)
  }
  return kept
}

/**
 * 记忆块装配：解析当前值 → 统一打分 → 分组 → 按预算截断。
 * 纯函数，不查库；调用方负责把记忆和相关性喂进来。
 */
export function assembleBlock(memories: Memory[], query: string | null, options: RecallOptions): string | null {
  const now = options.now ?? Date.now()
  const live = memories.filter((memory) => memory.state === 'active' && !isExpired(memory, now))
  if (live.length === 0) return null

  const buckets = bucketMemories(live, query, now, options.relevance ?? (() => 1))
  const total = buckets.user.length + buckets.character.length + buckets.relationship.length + buckets.past.length
  if (total === 0) return null

  const budget: Budget = { used: 0, cap: options.charCap }
  const lines: string[] = []
  for (const key of ['user', 'character', 'relationship'] as const) {
    const kept = takeWithin(buckets[key], budget)
    if (kept.length > 0) lines.push(`${GROUP_LABELS[key]}：${kept.join('；')}`)
  }

  const past = takeHistory(buckets.past, budget)
  if (past.length > 0) lines.push(`以前记下的（可能已过时）：${past.join('；')}`)

  if (lines.length === 0) return null
  lines.push('（以上是过往记忆，可能过时，以对方现在说的为准）')
  return `【你记得的事】\n${lines.join('\n')}`
}
