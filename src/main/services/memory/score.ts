import { authorityOf, retentionOf, type Memory } from './model'

/**
 * 注入排序只有一个分数：相关、重要、新鲜、到期、被印证次数各自归一后加权平均，
 * 最后乘一次来源可信度。不再让「重要度」在乘法里支配一切。
 */
export const SCORE_WEIGHTS = {
  relevance: 0.45,
  importance: 0.25,
  freshness: 0.15,
  due: 0.1,
  reinforce: 0.05,
} as const

const DUE_WINDOW_DAYS = 14
const REINFORCE_SATURATION = 5

export interface ScoreParts {
  relevance: number
  importance: number
  freshness: number
  due: number | null
  reinforce: number | null
  authority: number
  total: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function dueProximity(dueAt: string | null, now: number): number {
  if (!dueAt) return 0
  const time = Date.parse(dueAt)
  if (Number.isNaN(time)) return 0
  const days = (time - now) / 86_400_000
  if (days < -1 || days > DUE_WINDOW_DAYS) return 0
  return clamp01(1 - Math.max(0, days) / DUE_WINDOW_DAYS)
}

export function reinforceNorm(count: number): number {
  if (count <= 0) return 0
  return clamp01(Math.log1p(count) / Math.log1p(REINFORCE_SATURATION))
}

export function scoreParts(memory: Memory, relevance: number, now = Date.now()): ScoreParts {
  const parts: ScoreParts = {
    relevance: clamp01(relevance),
    importance: clamp01((memory.importance - 1) / 9),
    freshness: clamp01(retentionOf(memory, now)),
    due: memory.dueAt ? dueProximity(memory.dueAt, now) : null,
    reinforce: memory.evidence.reinforce > 0 ? reinforceNorm(memory.evidence.reinforce) : null,
    authority: authorityOf(memory.source),
    total: 0,
  }
  let sum = parts.relevance * SCORE_WEIGHTS.relevance
    + parts.importance * SCORE_WEIGHTS.importance
    + parts.freshness * SCORE_WEIGHTS.freshness
  let weights = SCORE_WEIGHTS.relevance + SCORE_WEIGHTS.importance + SCORE_WEIGHTS.freshness
  if (parts.due !== null) {
    sum += parts.due * SCORE_WEIGHTS.due
    weights += SCORE_WEIGHTS.due
  }
  if (parts.reinforce !== null) {
    sum += parts.reinforce * SCORE_WEIGHTS.reinforce
    weights += SCORE_WEIGHTS.reinforce
  }
  parts.total = (sum / weights) * parts.authority
  return parts
}

export function scoreMemory(memory: Memory, relevance: number, now = Date.now()): number {
  return scoreParts(memory, relevance, now).total
}
