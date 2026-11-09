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

function promiseLine(memory: Memory): string {
  const due = memory.dueAt && !Number.isNaN(Date.parse(memory.dueAt))
    ? `（约 ${memory.dueAt.slice(0, 10)}）`
    : ''
  return `约定：${shortText(memory)}${due}（还没兑现）`
}

/**
 * 记忆块装配：解析当前值 → 统一打分 → 分组 → 按预算截断。
 * 纯函数，不查库；调用方负责把记忆和相关性喂进来。
 */
export function assembleBlock(memories: Memory[], query: string | null, options: RecallOptions): string | null {
  const now = options.now ?? Date.now()
  const relevant = options.relevance ?? (() => 1)

  const live = memories.filter((memory) => memory.state === 'active' && !isExpired(memory, now))
  if (live.length === 0) return null

  const states = resolveCurrent(live)
  const current = states.flatMap((state) => state.current)
  const history = states.flatMap((state) => state.history)

  const scored = current.map((memory) => ({
    memory,
    text: shortText(memory),
    score: scoreMemory(memory, relevant(memory), now),
  }))

  const groups: Record<'user' | 'character' | 'relationship', Scored[]> = {
    user: [],
    character: [],
    relationship: [],
  }
  const promises: Scored[] = []
  const episodes: Scored[] = []

  for (const item of scored) {
    if (item.memory.kind === 'fact') {
      groups[item.memory.entity].push(item)
      continue
    }
    if (item.memory.dueAt && item.memory.state === 'active') promises.push(item)
    else episodes.push(item)
  }

  const relationship: Scored[] = [
    ...promises.sort(compare).map((item) => ({ ...item, text: promiseLine(item.memory) })),
    ...groups.relationship.sort(compare),
    ...episodes.sort(compare),
  ]

  const wantedHistory = wantsHistory(query)
  const past = wantedHistory ? uniqueHistory(history).slice(0, 5) : []
  if (current.length === 0 && past.length === 0) return null

  let used = 0
  const lines: string[] = []
  const emit = (label: string, items: Scored[]): void => {
    const kept: string[] = []
    for (const item of items) {
      if (used + item.text.length > options.charCap) break
      used += item.text.length
      kept.push(item.text)
    }
    if (kept.length > 0) lines.push(`${label}：${kept.join('；')}`)
  }

  emit(GROUP_LABELS.user, groups.user.sort(compare))
  emit(GROUP_LABELS.character, groups.character.sort(compare))
  emit(GROUP_LABELS.relationship, relationship)

  if (past.length > 0) {
    const kept: string[] = []
    for (const memory of past) {
      const text = shortText(memory)
      if (used + text.length > options.charCap) break
      used += text.length
      kept.push(text)
    }
    if (kept.length > 0) lines.push(`以前记下的（可能已过时）：${kept.join('；')}`)
  }

  if (lines.length === 0) return null
  lines.push('（以上是过往记忆，可能过时，以对方现在说的为准）')
  return `【你记得的事】\n${lines.join('\n')}`
}
