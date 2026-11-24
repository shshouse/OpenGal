/** 余弦相似度：维度不一致或零向量一律返回 0，避免把无效向量算成「很像」。 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let magA = 0
  let magB = 0
  for (let index = 0; index < a.length; index++) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    dot += left * right
    magA += left * left
    magB += right * right
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom > 0 ? dot / denom : 0
}
