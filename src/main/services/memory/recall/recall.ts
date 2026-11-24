import {
  isExpired,
  normalizeText,
  resolveCurrent,
  wantsHistory,
  type Memory,
} from '../model/model'
import { scoreMemory } from '../model/score'

export interface RecallOptions {
  charCap: number
  now?: number
  /** 相关性由调用方提供（向量或词面），缺省视为全部同等相关。 */
  relevance?: (memory: Memory) => number
  /** 真正写进上下文的记忆；历史区不算，避免让过期记忆一直续命。 */
  onUsed?: (memory: Memory) => void
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
  episodes: Scored[]
  promises: Scored[]
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

/** MMR 的多样性权重：1 只看分数，0 只看差异。0.7 是常见默认值。 */
const MMR_LAMBDA = 0.7

interface Prepared {
  item: Scored
  norm: string
  grams: Set<string>
}

function bigramsOf(input: string): Set<string> {
  const set = new Set<string>()
  for (let index = 0; index < input.length - 1; index++) set.add(input.slice(index, index + 2))
  return set
}

function prepare(item: Scored): Prepared {
  const norm = normalizeText(item.memory.text)
  return { item, norm, grams: bigramsOf(norm) }
}

/** 与 model.similarity 同口径，但入参已预处理，避免每轮重复归一化和建集合。 */
function overlapOf(a: Prepared, b: Prepared): number {
  if (!a.norm || !b.norm) return 0
  if (a.norm.includes(b.norm) || b.norm.includes(a.norm)) return 1
  if (a.grams.size === 0 || b.grams.size === 0) return 0
  let overlap = 0
  for (const gram of a.grams) if (b.grams.has(gram)) overlap++
  return (2 * overlap) / (a.grams.size + b.grams.size)
}

/**
 * 分组内 MMR：边挑边扣预算，挑满即停。
 * 每挑一条只刷新剩余候选的「最大重叠度」，把 O(n³) 的重算降到 O(n × 选中数)。
 * 只在同一分组内做，跨组不互相压制；约定类不参与，避免措辞相近的承诺被当成重复。
 */
function diversify(items: Scored[], budget: Budget, lambda = MMR_LAMBDA): Scored[] {
  if (items.length === 0) return []
  const pool = items.map(prepare)
  const taken = new Array<boolean>(pool.length).fill(false)
  const maxOverlap = new Array<number>(pool.length).fill(0)
  const kept: Scored[] = []

  while (true) {
    let bestIndex = -1
    let bestRank = Number.NEGATIVE_INFINITY
    for (let index = 0; index < pool.length; index++) {
      if (taken[index]) continue
      const entry = pool[index]
      if (!entry) continue
      const rank = lambda * entry.item.score - (1 - lambda) * (maxOverlap[index] ?? 0)
      if (rank > bestRank) {
        bestRank = rank
        bestIndex = index
      }
    }

    const chosen = bestIndex >= 0 ? pool[bestIndex] : undefined
    if (!chosen) break
    if (budget.used + chosen.item.text.length > budget.cap) break
    budget.used += chosen.item.text.length
    taken[bestIndex] = true
    kept.push(chosen.item)

    for (let index = 0; index < pool.length; index++) {
      if (taken[index]) continue
      const other = pool[index]
      if (!other) continue
      const overlap = overlapOf(chosen, other)
      if (overlap > (maxOverlap[index] ?? 0)) maxOverlap[index] = overlap
    }
  }

  return kept
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
    relationship: groups.relationship.sort(compare),
    episodes: episodes.sort(compare),
    promises: promises.sort(compare).map(promiseLine),
    past: wantsHistory(query)
      ? uniqueHistory(states.flatMap((state) => state.history)).slice(0, 5)
      : [],
  }
}

// 按顺序往预算里塞，塞不下就停；组之间共用同一个预算
function takeScored(items: Scored[], budget: Budget): Scored[] {
  const kept: Scored[] = []
  for (const item of items) {
    if (budget.used + item.text.length > budget.cap) break
    budget.used += item.text.length
    kept.push(item)
  }
  return kept
}

function takeLines(lines: string[], budget: Budget): string[] {
  const kept: string[] = []
  for (const text of lines) {
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
  const total =
    buckets.user.length +
    buckets.character.length +
    buckets.relationship.length +
    buckets.episodes.length +
    buckets.promises.length +
    buckets.past.length
  if (total === 0) return null

  // 预算按显示顺序消耗：关于他 → 关于你自己 → 约定 → 关系事实 → 情节
  const budget: Budget = { used: 0, cap: options.charCap }
  const user = diversify(buckets.user, budget)
  const character = diversify(buckets.character, budget)
  const promises = takeScored(buckets.promises, budget)
  const relationship = diversify(buckets.relationship, budget)
  const episodes = diversify(buckets.episodes, budget)

  const lines: string[] = []
  const sections: Array<[string, Scored[]]> = [
    [GROUP_LABELS.user, user],
    [GROUP_LABELS.character, character],
    [GROUP_LABELS.relationship, [...promises, ...relationship, ...episodes]],
  ]
  for (const [label, items] of sections) {
    if (items.length === 0) continue
    lines.push(`${label}：${items.map((item) => item.text).join('；')}`)
    for (const item of items) options.onUsed?.(item.memory)
  }

  const past = takeLines(buckets.past.map(shortText), budget)
  if (past.length > 0) lines.push(`以前记下的（可能已过时）：${past.join('；')}`)

  if (lines.length === 0) return null
  lines.push('（以上是过往记忆，可能过时，以对方现在说的为准）')
  return `【你记得的事】\n${lines.join('\n')}`
}
