import type {
  MemoryCandidateFact,
  MemoryCandidateStory,
  MemoryApplyPayload,
  MemoryConfig,
  MemoryFact,
  MemoryStory,
} from '@shared/types'
import {
  initMemoryDb,
  memoryDbReady,
  listFacts,
  saveFacts,
  listStories,
  saveStories,
  clearCharacterMemory,
  type FactRow,
  type StoryRow,
} from './memoryDb.ts'
import { computeEmbeddingAsync, searchSimilarAsync } from './vectorSearch.ts'

export type FactJudge = (
  existing: MemoryFact,
  candidate: MemoryCandidateFact,
) => Promise<'reinforces' | 'negates'>

let config: MemoryConfig = {
  factBudgetChars: 4000,
  storyBudgetChars: 3000,
  injectCharCap: 900,
  batchTurns: 8,
  idleMinutes: 5,
  fallbackHours: 12,
  windowBatchTurns: 10,
}

export function initMemoryStore(root: string, cfg?: Partial<MemoryConfig>): void {
  if (cfg) config = { ...config, ...cfg }
  void initMemoryDb(root).catch(() => {})
}

export function getMemoryConfig(): MemoryConfig {
  return config
}

// ---- 行 <-> 类型转换 ----

function rowToFact(r: FactRow): MemoryFact {
  return {
    id: r.id,
    text: r.text,
    entity: r.entity as MemoryFact['entity'],
    importance: r.importance,
    confidence: r.confidence,
    source: r.source as MemoryFact['source'],
    created_at: r.created_at,
    last_confirmed_at: r.last_confirmed_at,
    status: r.status as MemoryFact['status'],
    evidence: { reinforce: r.evidence_reinforce, negate: r.evidence_negate },
    protected: r.protected_ === 1,
    valid_until: r.valid_until ?? null,
    frozen_at: r.frozen_at ?? null,
    embedding: r.embedding ? (JSON.parse(r.embedding) as number[]) : null,
  }
}

function factToRow(f: MemoryFact): FactRow {
  return {
    id: f.id,
    character_id: '',
    text: f.text,
    entity: f.entity,
    importance: f.importance,
    confidence: f.confidence,
    source: f.source,
    created_at: f.created_at,
    last_confirmed_at: f.last_confirmed_at,
    status: f.status,
    evidence_reinforce: f.evidence.reinforce,
    evidence_negate: f.evidence.negate,
    protected_: f.protected ? 1 : 0,
    valid_until: f.valid_until,
    frozen_at: f.frozen_at,
    embedding: f.embedding ? JSON.stringify(f.embedding) : null,
  }
}

function rowToStory(r: StoryRow): MemoryStory {
  return {
    id: r.id,
    kind: r.kind as MemoryStory['kind'],
    text: r.text,
    occurred_at: r.occurred_at,
    due_at: r.due_at,
    fulfilled: r.fulfilled === 1,
    importance: r.importance,
    status: r.status as MemoryStory['status'],
    created_at: r.created_at,
  }
}

function storyToRow(s: MemoryStory): StoryRow {
  return {
    id: s.id,
    character_id: '',
    kind: s.kind,
    text: s.text,
    occurred_at: s.occurred_at,
    due_at: s.due_at,
    fulfilled: s.fulfilled ? 1 : 0,
    importance: s.importance,
    status: s.status,
    created_at: s.created_at,
  }
}

async function loadFactsTyped(characterId: string): Promise<MemoryFact[]> {
  await memoryDbReady()
  return listFacts(characterId).map(rowToFact)
}

async function loadStoriesTyped(characterId: string): Promise<MemoryStory[]> {
  await memoryDbReady()
  return listStories(characterId).map(rowToStory)
}

export async function loadFacts(characterId: string): Promise<MemoryFact[]> {
  return loadFactsTyped(characterId)
}

export async function loadStories(characterId: string): Promise<MemoryStory[]> {
  return loadStoriesTyped(characterId)
}

export async function clearMemory(characterId: string): Promise<void> {
  await memoryDbReady()
  clearCharacterMemory(characterId)
}

export function normalizeText(s: string): string {
  return s.replace(/[\s，。？！、,.?!;；:：""''「」（）()\-—~～]/g, '')
}

export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return 0
  if (na.includes(nb) || nb.includes(na)) return 1
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const ba = bigrams(na)
  const bb = bigrams(nb)
  if (ba.size === 0 || bb.size === 0) return 0
  let inter = 0
  for (const g of ba) if (bb.has(g)) inter++
  return (2 * inter) / (ba.size + bb.size)
}

const HIGH_SIMILARITY = 0.6
const MID_SIMILARITY = 0.35

export type Adjudication =
  | { action: 'insert' }
  | { action: 'refresh'; target: MemoryFact }
  | { action: 'judge'; target: MemoryFact }

export function adjudicateFact(
  candidate: MemoryCandidateFact,
  active: MemoryFact[],
): Adjudication {
  let best: MemoryFact | null = null
  let bestSim = 0
  for (const f of active) {
    if (f.entity !== candidate.entity) continue
    const sim = textSimilarity(candidate.text, f.text)
    if (sim > bestSim) {
      bestSim = sim
      best = f
    }
  }
  if (best && bestSim >= HIGH_SIMILARITY) return { action: 'refresh', target: best }
  if (best && bestSim >= MID_SIMILARITY && best.entity === candidate.entity) {
    return { action: 'judge', target: best }
  }
  return { action: 'insert' }
}

function nowIso(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function isFactExpired(f: MemoryFact): boolean {
  if (!f.valid_until) return false
  return new Date(f.valid_until).getTime() < Date.now()
}

function isFactFrozen(f: MemoryFact): boolean {
  return f.frozen_at !== null
}

export function retentionScore(f: MemoryFact): number {
  if (isFactFrozen(f)) return 1
  if (isFactExpired(f)) return 0
  const days = (Date.now() - new Date(f.last_confirmed_at).getTime()) / 86400000
  const stability = f.importance * 7
  return Math.exp(-days / stability)
}

export function factScore(f: MemoryFact): number {
  return f.importance * f.confidence * retentionScore(f)
}

export function storyScore(s: MemoryStory): number {
  const kindWeight = s.kind === 'milestone' ? 1.3 : s.kind === 'promise' ? 1.2 : s.kind === 'joke' ? 0.9 : 1
  return s.importance * kindWeight
}

function activeFacts(facts: MemoryFact[]): MemoryFact[] {
  return facts.filter((f) => f.status === 'active' && !isFactExpired(f))
}

function activeStories(stories: MemoryStory[]): MemoryStory[] {
  return stories.filter((s) => s.status === 'active')
}

function charsOf(list: { text: string }[]): number {
  return list.reduce((sum, x) => sum + x.text.length, 0)
}

function fitBudget<T extends { text: string; status: 'active' | 'archived'; protected?: boolean; frozen_at?: string | null }>(
  all: T[],
  incoming: T,
  budget: number,
  scoreOf: (x: T) => number,
): T | null {
  if (incoming.text.length > budget) return null
  const activeChars = (): number => charsOf(all.filter((x) => x.status === 'active'))
  if (activeChars() + incoming.text.length <= budget) return incoming
  const ordered = all
    .filter((x) => x.status === 'active' && !x.protected && !x.frozen_at)
    .sort((a, b) => scoreOf(a) - scoreOf(b))
  for (const item of ordered) {
    item.status = 'archived'
    if (activeChars() + incoming.text.length <= budget) return incoming
  }
  return null
}

export interface ApplyResult {
  insertedFacts: number
  refreshedFacts: number
  judgedAway: number
  insertedStories: number
  budgetRejected: number
}

export async function applyCandidates(
  characterId: string,
  payload: MemoryApplyPayload,
  judge?: FactJudge,
): Promise<ApplyResult> {
  const facts = await loadFactsTyped(characterId)
  const stories = await loadStoriesTyped(characterId)
  const result: ApplyResult = {
    insertedFacts: 0,
    refreshedFacts: 0,
    judgedAway: 0,
    insertedStories: 0,
    budgetRejected: 0,
  }
  const ts = nowIso()

  for (const cand of payload.facts ?? []) {
    if (!cand.text?.trim()) continue
    const source = cand.confidence >= 1 ? 'user_statement' : 'llm_inferred'
    const adjudication = adjudicateFact(cand, activeFacts(facts))
    if (adjudication.action === 'refresh') {
      adjudication.target.last_confirmed_at = ts
      adjudication.target.evidence.reinforce += 1
      result.refreshedFacts++
      continue
    }
    if (adjudication.action === 'judge') {
      if (!judge) {
        result.judgedAway++
        continue
      }
      try {
        const verdict = await judge(adjudication.target, cand)
        if (verdict === 'reinforces' || adjudication.target.protected) {
          adjudication.target.last_confirmed_at = ts
          adjudication.target.evidence.reinforce += 1
          result.refreshedFacts++
        } else {
          adjudication.target.status = 'archived'
          adjudication.target.evidence.negate += 1
          facts.push({
            id: newId('f'),
            text: cand.text,
            entity: cand.entity,
            importance: Math.min(10, Math.max(1, Math.round(cand.importance))),
            confidence: Math.min(1, Math.max(0.1, cand.confidence)),
            source,
            created_at: ts,
            last_confirmed_at: ts,
            status: 'active',
            evidence: { reinforce: 0, negate: 0 },
            valid_until: cand.valid_until ?? null,
            frozen_at: null,
            embedding: null,
          })
          result.insertedFacts++
        }
      } catch {
        result.judgedAway++
      }
      continue
    }
    const entry: MemoryFact = {
      id: newId('f'),
      text: cand.text,
      entity: cand.entity,
      importance: Math.min(10, Math.max(1, Math.round(cand.importance))),
      confidence: Math.min(1, Math.max(0.1, cand.confidence)),
      source,
      created_at: ts,
      last_confirmed_at: ts,
      status: 'active',
      evidence: { reinforce: 0, negate: 0 },
      valid_until: cand.valid_until ?? null,
      frozen_at: cand.frozen ? ts : null,
      embedding: null, // 延迟计算：写入时先不 embedding，首次检索时批量算
    }
    const accepted = fitBudget(facts, entry, config.factBudgetChars, factScore)
    if (!accepted) {
      result.budgetRejected++
      continue
    }
    facts.push(entry)
    result.insertedFacts++
  }

  for (const cand of payload.stories ?? []) {
    if (!cand.text?.trim()) continue
    const entry: MemoryStory = {
      id: newId('s'),
      kind: cand.kind,
      text: cand.text,
      occurred_at: ts,
      due_at: cand.due_at ?? null,
      fulfilled: false,
      importance: Math.min(10, Math.max(1, Math.round(cand.importance))),
      status: 'active',
      created_at: ts,
    }
    const accepted = fitBudget(stories, entry, config.storyBudgetChars, storyScore)
    if (!accepted) {
      result.budgetRejected++
      continue
    }
    stories.push(entry)
    result.insertedStories++
  }

  await memoryDbReady()
  saveFacts(characterId, facts.map(factToRow))
  saveStories(characterId, stories.map(storyToRow))
  return result
}

export async function manualAddFact(
  characterId: string,
  text: string,
  entity: MemoryFact['entity'] = 'user',
): Promise<MemoryFact> {
  const facts = await loadFactsTyped(characterId)
  const ts = nowIso()
  const entry: MemoryFact = {
    id: newId('f'),
    text,
    entity,
    importance: 10,
    confidence: 1,
    source: 'manual',
    created_at: ts,
    last_confirmed_at: ts,
    status: 'active',
    evidence: { reinforce: 0, negate: 0 },
    protected: true,
    valid_until: null,
    frozen_at: ts,
    embedding: null,
  }
  facts.push(entry)
  await memoryDbReady()
  saveFacts(characterId, facts.map(factToRow))
  return entry
}

export function relevanceScore(factText: string, context: string): number {
  const normFact = normalizeText(factText)
  const normCtx = normalizeText(context)
  if (!normFact || !normCtx) return 0
  if (normCtx.includes(normFact) || normFact.includes(normCtx)) return 1
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const bf = bigrams(normFact)
  const bc = bigrams(normCtx)
  if (bf.size === 0 || bc.size === 0) return 0
  let inter = 0
  for (const g of bf) if (bc.has(g)) inter++
  return (2 * inter) / (bf.size + bc.size)
}

export function buildMemoryBlock(
  facts: MemoryFact[],
  stories: MemoryStory[],
  charCap = config.injectCharCap,
  context?: string,
): string | null {
  const actives = activeFacts(facts)
  const activeStoriesList = activeStories(stories)
  if (actives.length === 0 && activeStoriesList.length === 0) return null

  type Item = { text: string; score: number; rel: number }
  const groups: Record<'user' | 'character' | 'relationship', Item[]> = {
    user: [],
    character: [],
    relationship: [],
  }
  for (const f of [...actives].sort((a, b) => factScore(b) - factScore(a))) {
    const rel = context ? relevanceScore(f.text, context) : 0.5
    const score = factScore(f) * (0.5 + rel)
    groups[f.entity].push({ text: f.text.slice(0, 60), score, rel })
  }

  const promises = activeStoriesList
    .filter((s) => s.kind === 'promise' && !s.fulfilled)
    .sort((a, b) => storyScore(b) - storyScore(a))
  const others = activeStoriesList
    .filter((s) => s.kind !== 'promise' || s.fulfilled)
    .sort((a, b) => storyScore(b) - storyScore(a))
    .slice(0, 6)

  const lines: string[] = []
  const relationshipItems: Item[] = []
  for (const p of promises) {
    const due = p.due_at ? `（约 ${p.due_at.slice(0, 10)}）` : ''
    const rel = context ? relevanceScore(p.text, context) : 0.5
    relationshipItems.push({ text: `约定：${p.text}${due}（还没兑现）`, score: storyScore(p) + 5, rel })
  }
  for (const s of others) {
    const rel = context ? relevanceScore(s.text, context) : 0.5
    relationshipItems.push({ text: s.text.slice(0, 60), score: storyScore(s) * (0.5 + rel), rel })
  }

  let total = 0
  const kept: string[] = []
  const emit: Array<[string, Item[]]> = [
    ['关于他', groups.user],
    ['关于你自己', groups.character],
    ['关于你们', relationshipItems],
  ]
  for (const [label, items] of emit) {
    items.sort((a, b) => b.score - a.score)
    const groupLines: string[] = []
    for (const item of items) {
      if (total + item.text.length > charCap) break
      total += item.text.length
      groupLines.push(item.text)
    }
    if (groupLines.length > 0) kept.push(`${label}：${groupLines.join('；')}`)
  }
  lines.push(...kept)
  if (lines.length === 0) return null
  lines.push('（以上是过往记忆，可能过时，以对方现在说的为准）')
  return `【你记得的事】\n${lines.join('\n')}`
}

export async function getMemoryBlock(
  characterId: string,
  context?: string,
  useVector = false,
): Promise<string | null> {
  const [facts, stories] = await Promise.all([
    loadFactsTyped(characterId),
    loadStoriesTyped(characterId),
  ])
  if (useVector && context) {
    return buildMemoryBlockVector(characterId, facts, stories, context, config.injectCharCap)
  }
  return buildMemoryBlock(facts, stories, config.injectCharCap, context)
}

export async function buildMemoryBlockVector(
  characterId: string,
  facts: MemoryFact[],
  stories: MemoryStory[],
  context: string,
  charCap: number,
): Promise<string | null> {
  const actives = activeFacts(facts)
  const activeStoriesList = activeStories(stories)
  if (actives.length === 0 && activeStoriesList.length === 0) return null

  // 模型未就绪时降级到关键词检索，并记录日志
  let vectorHits: Array<{ fact: MemoryFact; similarity: number }> = []
  let vectorFailed = false
  try {
    const needEmbedding = actives.filter((f) => !f.embedding)
    if (needEmbedding.length > 0) {
      for (const f of needEmbedding) {
        f.embedding = await computeEmbeddingAsync(f.text)
      }
      await memoryDbReady()
      saveFacts(characterId, facts.map(factToRow))
    }
    vectorHits = await searchSimilarAsync(actives, context, 10, 0.2)
  } catch (err) {
    console.warn(`[memory] 向量检索失败，降级到关键词: ${(err as Error).message}`)
  }
  const hitIds = new Set(vectorHits.map((h) => h.fact.id))

  type Item = { text: string; score: number; source: 'vector' | 'keyword' }
  const groups: Record<'user' | 'character' | 'relationship', Item[]> = {
    user: [],
    character: [],
    relationship: [],
  }

  for (const f of actives) {
    const isVectorHit = hitIds.has(f.id)
    const rel = isVectorHit
      ? vectorHits.find((h) => h.fact.id === f.id)!.similarity
      : relevanceScore(f.text, context)
    const score = factScore(f) * (0.3 + rel)
    const item: Item = { text: f.text.slice(0, 60), score, source: isVectorHit ? 'vector' : 'keyword' }
    groups[f.entity].push(item)
  }

  const promises = activeStoriesList
    .filter((s) => s.kind === 'promise' && !s.fulfilled)
    .sort((a, b) => storyScore(b) - storyScore(a))
  const others = activeStoriesList
    .filter((s) => s.kind !== 'promise' || s.fulfilled)
    .sort((a, b) => storyScore(b) - storyScore(a))
    .slice(0, 6)

  const lines: string[] = []
  const relationshipItems: Item[] = []
  for (const p of promises) {
    const due = p.due_at ? `（约 ${p.due_at.slice(0, 10)}）` : ''
    const rel = relevanceScore(p.text, context)
    relationshipItems.push({ text: `约定：${p.text}${due}（还没兑现）`, score: storyScore(p) + 5, source: 'keyword' })
  }
  for (const s of others) {
    const rel = relevanceScore(s.text, context)
    relationshipItems.push({ text: s.text.slice(0, 60), score: storyScore(s) * (0.3 + rel), source: 'keyword' })
  }

  let total = 0
  const kept: string[] = []
  const emit: Array<[string, Item[]]> = [
    ['关于他', groups.user],
    ['关于你自己', groups.character],
    ['关于你们', relationshipItems],
  ]
  for (const [label, items] of emit) {
    items.sort((a, b) => b.score - a.score)
    const groupLines: string[] = []
    for (const item of items) {
      if (total + item.text.length > charCap) break
      total += item.text.length
      groupLines.push(item.text)
    }
    if (groupLines.length > 0) kept.push(`${label}：${groupLines.join('；')}`)
  }
  lines.push(...kept)
  if (lines.length === 0) return null
  lines.push('（以上是过往记忆，可能过时，以对方现在说的为准）')
  return `【你记得的事】\n${lines.join('\n')}`
}

// 遗忘曲线清理：retention < 0.1 且未冻结/未保护的记忆自动归档
export async function decaySweep(characterId: string): Promise<{ archived: number }> {
  const facts = await loadFactsTyped(characterId)
  let archived = 0
  for (const f of facts) {
    if (f.status !== 'active') continue
    if (f.protected || isFactFrozen(f)) continue
    if (retentionScore(f) < 0.1) {
      f.status = 'archived'
      archived++
    }
  }
  if (archived > 0) {
    await memoryDbReady()
    saveFacts(characterId, facts.map(factToRow))
  }
  return { archived }
}

export async function freezeFact(characterId: string, factId: string): Promise<boolean> {
  const facts = await loadFactsTyped(characterId)
  const target = facts.find((f) => f.id === factId)
  if (!target) return false
  target.frozen_at = nowIso()
  await memoryDbReady()
  saveFacts(characterId, facts.map(factToRow))
  return true
}

export async function unfreezeFact(characterId: string, factId: string): Promise<boolean> {
  const facts = await loadFactsTyped(characterId)
  const target = facts.find((f) => f.id === factId)
  if (!target) return false
  target.frozen_at = null
  await memoryDbReady()
  saveFacts(characterId, facts.map(factToRow))
  return true
}

export async function deleteFact(characterId: string, factId: string): Promise<boolean> {
  const facts = await loadFactsTyped(characterId)
  const idx = facts.findIndex((f) => f.id === factId)
  if (idx === -1) return false
  facts.splice(idx, 1)
  await memoryDbReady()
  saveFacts(characterId, facts.map(factToRow))
  return true
}
