export interface SummaryLike {
  text: string
  end_ts: number
}

/**
 * 摘要注入预算：只取最近的若干条，并按字符上限从新到旧累计，避免历史越久注入越多。
 * 返回保持时间正序，便于拼进上下文时读起来连贯。
 */
export function pickRecentSummaries<T extends SummaryLike>(
  rows: T[],
  maxChars = 4000,
  maxCount = 20,
): T[] {
  if (rows.length === 0) return []
  const newestFirst = [...rows].sort((a, b) => b.end_ts - a.end_ts).slice(0, Math.max(0, maxCount))
  const kept: T[] = []
  let used = 0
  for (const row of newestFirst) {
    const size = row.text.length
    if (used + size > maxChars) break
    kept.push(row)
    used += size
  }
  return kept.reverse()
}
