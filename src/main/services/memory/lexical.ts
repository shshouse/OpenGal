import { normalizeText } from './model'

const BM25_K1 = 1.5
const BM25_B = 0.75

function bigramsOf(norm: string): string[] {
  const out: string[] = []
  for (let index = 0; index < norm.length - 1; index++) out.push(norm.slice(index, index + 2))
  return out
}

function bm25Score(factNorm: string, contextNorm: string): number {
  const contextTerms = bigramsOf(contextNorm)
  if (!factNorm || contextTerms.length === 0) return 0
  const factTerms = bigramsOf(factNorm)
  if (factTerms.length === 0) return 0
  const termFrequency = new Map<string, number>()
  for (const term of factTerms) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1)
  // 已知近似：avgdl 用文档自身长度代替语料平均长度，长度归一化恒为 1，退化为纯 tf 加权；单机够用
  const avgdl = Math.max(1, factTerms.length)
  let score = 0
  for (const term of new Set(contextTerms)) {
    const frequency = termFrequency.get(term)
    if (!frequency) continue
    score += (frequency * (BM25_K1 + 1))
      / (frequency + BM25_K1 * (1 - BM25_B + (BM25_B * factTerms.length) / avgdl))
  }
  return score / contextTerms.length
}

/** 词面相关性：整段包含记满分，其余按相邻双字加权。 */
export function relevanceScore(factText: string, context: string): number {
  const normFact = normalizeText(factText)
  const normContext = normalizeText(context)
  if (!normFact || !normContext) return 0
  if (normContext.includes(normFact) || normFact.includes(normContext)) return 1
  return bm25Score(normFact, normContext)
}
