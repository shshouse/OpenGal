export type MemoryVerdict = 'duplicate' | 'refines' | 'contradicts' | 'unrelated'

export interface FactLike {
  id: string
  text: string
  entity: string
  subject?: string | null
  attribute?: string | null
  status?: string
  source?: string
  importance?: number
  confidence?: number
  created_at?: string
  last_confirmed_at?: string
  valid_until?: string | null
  frozen_at?: string | null
  evidence?: { reinforce: number, negate: number }
}

export interface CandidateLike {
  text: string
  entity: string
  subject?: string | null
  attribute?: string | null
}

// 相似度只负责把候选找出来，不参与裁决；阈值放宽，宁可多问一次裁判
export const SIMILARITY_FLOOR = 0.4

const PUNCT = /[\s，。？！、,.?!;；:：""''「」『』（）()[\]【】\-—~～]/g
const HISTORY_HINTS = /以前|之前|曾经|上次|上回|那时候|当时|去年|前年|小时候|过去|原来|还记得|记得.*吗|说过/

export function normalizeText(input: string): string {
  return input.replace(PUNCT, '').toLowerCase()
}

function bigrams(input: string): Set<string> {
  const set = new Set<string>()
  for (let index = 0; index < input.length - 1; index++) set.add(input.slice(index, index + 2))
  return set
}

export function similarity(a: string, b: string): number {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (!left || !right) return 0
  if (left.includes(right) || right.includes(left)) return 1
  const ba = bigrams(left)
  const bb = bigrams(right)
  if (ba.size === 0 || bb.size === 0) return 0
  let overlap = 0
  for (const gram of ba) if (bb.has(gram)) overlap++
  return (2 * overlap) / (ba.size + bb.size)
}

// 槽位 = 实体 + 主语 + 属性，例如 user|用户|居住城市；缺任一项视为无槽位
export function slotKey(input: { entity: string, subject?: string | null, attribute?: string | null }): string | null {
  const subject = input.subject ? normalizeText(input.subject) : ''
  const attribute = input.attribute ? normalizeText(input.attribute) : ''
  if (!subject || !attribute) return null
  return `${input.entity}|${subject}|${attribute}`
}

function confirmedAt(fact: FactLike): number {
  const stamp = fact.last_confirmed_at || fact.created_at || ''
  const parsed = Date.parse(stamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * 找出新事实可能取代/补充的那条旧事实。
 * 槽位相同直接命中；否则退回相似度召回，交给语义裁判决定怎么办。
 */
export function pickTarget(
  candidate: CandidateLike,
  facts: FactLike[],
): { target: FactLike, via: 'slot' | 'similarity' } | null {
  const key = slotKey(candidate)
  if (key) {
    const sameSlot = facts.filter(fact => fact.entity === candidate.entity && slotKey(fact) === key)
    if (sameSlot.length > 0) {
      const target = sameSlot.reduce((best, fact) => (confirmedAt(fact) > confirmedAt(best) ? fact : best))
      return { target, via: 'slot' }
    }
  }

  let best: FactLike | null = null
  let bestSimilarity = 0
  for (const fact of facts) {
    if (fact.entity !== candidate.entity) continue
    const score = similarity(candidate.text, fact.text)
    if (score > bestSimilarity) {
      bestSimilarity = score
      best = fact
    }
  }
  if (best && bestSimilarity >= SIMILARITY_FLOOR) return { target: best, via: 'similarity' }
  return null
}

export function decide(verdict: MemoryVerdict): 'reinforce' | 'supersede' | 'insert' {
  if (verdict === 'duplicate') return 'reinforce'
  if (verdict === 'contradicts') return 'supersede'
  return 'insert'
}

export function parseVerdict(raw: unknown): MemoryVerdict {
  return raw === 'duplicate' || raw === 'refines' || raw === 'contradicts' ? raw : 'unrelated'
}

export function authorityOf(source?: string): number {
  if (source === 'user_statement' || source === 'manual') return 1
  if (source === 'character_statement') return 0.75
  return 0.5
}

export function retentionOf(fact: FactLike, now = Date.now()): number {
  if (fact.frozen_at) return 1
  if (fact.valid_until) {
    const expiry = Date.parse(fact.valid_until)
    if (!Number.isNaN(expiry) && expiry < now) return 0
  }
  const stamp = fact.last_confirmed_at || fact.created_at || ''
  const confirmed = Date.parse(stamp)
  if (Number.isNaN(confirmed)) return 1
  const days = Math.max(0, (now - confirmed) / 86_400_000)
  const stability = Math.max(1, (fact.importance ?? 5) * 7)
  return Math.max(0, Math.min(1, Math.exp(-days / stability)))
}

export function scoreOf(fact: FactLike, now = Date.now()): number {
  const reinforce = fact.evidence?.reinforce ?? 0
  const evidenceBoost = 1 + Math.min(0.6, 0.15 * Math.log1p(reinforce))
  return (fact.importance ?? 5)
    * (fact.confidence ?? 0.5)
    * authorityOf(fact.source)
    * retentionOf(fact, now)
    * evidenceBoost
}

export function wantsHistory(text?: string | null): boolean {
  return !!text && HISTORY_HINTS.test(text)
}

// 同一槽位只保留一条进入提示词：冻结的优先，其次分数高的
export function sameSlotDedupe<T extends FactLike>(facts: T[], now = Date.now()): T[] {
  const chosen = new Map<string, T>()
  for (const fact of facts) {
    const key = slotKey(fact)
    if (!key) continue
    const current = chosen.get(key)
    if (!current) {
      chosen.set(key, fact)
      continue
    }
    if (!!fact.frozen_at !== !!current.frozen_at) {
      if (fact.frozen_at) chosen.set(key, fact)
      continue
    }
    if (scoreOf(fact, now) > scoreOf(current, now)) chosen.set(key, fact)
  }
  const kept = new Set(chosen.values())
  return facts.filter(fact => !slotKey(fact) || kept.has(fact))
}
