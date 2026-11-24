import { isPositive, similarity, slotOf, type Memory } from '../model/model'
import { cosineSimilarity } from '../model/cosine'

/** 字面重复：同一句话换个标点。 */
export const FACT_LEXICAL_SIMILARITY = 0.9
/** 语义重复：同一件事换种说法，需要向量。 */
export const FACT_SEMANTIC_SIMILARITY = 0.92
export const EPISODE_LEXICAL_SIMILARITY = 0.9
export const EPISODE_SEMANTIC_SIMILARITY = 0.9
/** 情节只在最近一周内合并：更早的相似经历视为不同事件。 */
export const EPISODE_MERGE_WINDOW_MS = 7 * 86_400_000

function semanticMatch(left: Memory, right: Memory, threshold: number): boolean {
  if (!left.embedding || !right.embedding) return false
  return cosineSimilarity(left.embedding, right.embedding) >= threshold
}

/**
 * 事实是否与已有记录重复。
 * 槽位和极性是硬条件：不同属性、或一正一负，绝不能因为措辞像就合并。
 */
export function isRepeatedFact(memory: Memory, entry: Memory): boolean {
  if (memory.kind !== 'fact' || memory.state !== 'active') return false
  if (slotOf(memory) !== slotOf(entry)) return false
  if (isPositive({ polarity: !memory.negated }) !== isPositive({ polarity: !entry.negated })) return false
  if (similarity(memory.text, entry.text) >= FACT_LEXICAL_SIMILARITY) return true
  return semanticMatch(memory, entry, FACT_SEMANTIC_SIMILARITY)
}

/**
 * 找出可以合并的情节。承诺类还要求截止时间一致，
 * 否则「明天叫他起床」和「后天叫他起床」会被当成同一件事。
 */
export function findRepeatedEpisode(existing: Memory[], entry: Memory): Memory | null {
  const at = entry.happenedAt ?? entry.createdAt
  const found = existing.find((memory) => {
    if (memory.kind !== 'episode' || memory.state !== 'active') return false
    if (memory.episodeKind !== entry.episodeKind) return false
    if ((memory.dueAt ?? '') !== (entry.dueAt ?? '')) return false
    const happened = memory.happenedAt ?? memory.createdAt
    if (Math.abs(at - happened) > EPISODE_MERGE_WINDOW_MS) return false
    if (similarity(memory.text, entry.text) >= EPISODE_LEXICAL_SIMILARITY) return true
    return semanticMatch(memory, entry, EPISODE_SEMANTIC_SIMILARITY)
  })
  return found ?? null
}
