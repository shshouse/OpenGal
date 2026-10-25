import type {
  MemoryCandidateFact,
  MemoryApplyPayload,
  MemoryConfig,
  MemoryFact,
  MemoryStory,
} from '@shared/types'
import {
  initMemoryDb,
  memoryDbReady,
  listFacts,
  listStories,
  clearCharacterMemory,
  insertFactRow,
  insertStoryRow,
  getFactRow,
  reinforceFactRow,
  negateFactRow,
  setFactStatusRow,
  setFactFrozenRow,
  setFactEmbeddingRow,
  deleteFactRow,
  setStoryStatusRow,
  searchMessageContext,
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
}

export function initMemoryStore(root: string, cfg?: Partial<MemoryConfig>, backupRoot?: string): void {
  if (cfg) config = { ...config, ...cfg }
  void initMemoryDb(root, backupRoot).catch(() => {})
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
  const stamp = f.last_confirmed_at || f.created_at
  const confirmed = new Date(stamp).getTime()
  if (Number.isNaN(confirmed)) return 1
  const days = (Date.now() - confirmed) / 86400000
  const stability = Math.max(1, f.importance * 7)
  return Math.max(0, Math.min(1, Math.exp(-Math.max(0, days) / stability)))
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

function fitBudget<T extends { id: string; text: string; status: 'active' | 'archived'; protected?: boolean; frozen_at?: string | null }>(
  all: T[],
  incoming: T,
  budget: number,
  scoreOf: (x: T) => number,
): { accepted: T | null; archivedIds: string[] } {
  const archivedIds: string[] = []
  if (incoming.text.length > budget) return { accepted: null, archivedIds }
  const activeChars = (): number => charsOf(all.filter((x) => x.status === 'active'))
  if (activeChars() + incoming.text.length <= budget) return { accepted: incoming, archivedIds }
  const ordered = all
    .filter((x) => x.status === 'active' && !x.protected && !x.frozen_at)
    .sort((a, b) => scoreOf(a) - scoreOf(b))
  for (const item of ordered) {
    item.status = 'archived'
    archivedIds.push(item.id)
    if (activeChars() + incoming.text.length <= budget) return { accepted: incoming, archivedIds }
  }
  return { accepted: null, archivedIds }
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
      await memoryDbReady()
      reinforceFactRow(adjudication.target.id, ts)
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
        // 关键：await 期间目标可能被用户删除或冻结，以用户操作为准，不用旧快照覆盖
        const freshRow = getFactRow(adjudication.target.id)
        if (!freshRow) {
          result.judgedAway++
          continue
        }
        const fresh = rowToFact(freshRow)
        const local = facts.find((f) => f.id === fresh.id)
        if (verdict === 'reinforces' || fresh.protected || fresh.frozen_at) {
          reinforceFactRow(fresh.id, ts)
          if (local) {
            local.last_confirmed_at = ts
            local.evidence.reinforce += 1
            local.frozen_at = fresh.frozen_at
          }
          result.refreshedFacts++
        } else {
          negateFactRow(fresh.id)
          if (local) {
            local.status = 'archived'
            local.evidence.negate += 1
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
            frozen_at: null,
            embedding: null,
          }
          facts.push(entry)
          insertFactRow(characterId, factToRow(entry))
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
    const fit = fitBudget(facts, entry, config.factBudgetChars, factScore)
    for (const id of fit.archivedIds) setFactStatusRow(id, 'archived')
    if (!fit.accepted) {
      result.budgetRejected++
      continue
    }
    facts.push(entry)
    insertFactRow(characterId, factToRow(entry))
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
    const fit = fitBudget(stories, entry, config.storyBudgetChars, storyScore)
    for (const id of fit.archivedIds) setStoryStatusRow(id, 'archived')
    if (!fit.accepted) {
      result.budgetRejected++
      continue
    }
    stories.push(entry)
    insertStoryRow(characterId, storyToRow(entry))
    result.insertedStories++
  }

  return result
}

export async function manualAddFact(
  characterId: string,
  text: string,
  entity: MemoryFact['entity'] = 'user',
): Promise<MemoryFact> {
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
  await memoryDbReady()
  insertFactRow(characterId, factToRow(entry))
  return entry
}

const BM25_K1 = 1.5
const BM25_B = 0.75
function bm25Score(factNorm: string, ctxNorm: string): number {
  const ctxTerms = bigramsOf(ctxNorm)
  if (!factNorm || ctxTerms.length === 0) return 0
  const factTerms = bigramsOf(factNorm)
  if (factTerms.length === 0) return 0
  const tf = new Map<string, number>()
  for (const t of factTerms) tf.set(t, (tf.get(t) ?? 0) + 1)
  // ponytail: avgdl 用文档自身长度代替语料平均长度，长度归一化恒为 1，退化为纯 tf 加权；单机启发式够用，升级需收集全库平均长度
  const avgdl = Math.max(1, factTerms.length)
  let score = 0
  for (const term of new Set(ctxTerms)) {
    const freq = tf.get(term)
    if (!freq) continue
    score += (freq * (BM25_K1 + 1)) / (freq + BM25_K1 * (1 - BM25_B + (BM25_B * factTerms.length) / avgdl))
  }
  return score / ctxTerms.length
}

function bigramsOf(norm: string): string[] {
  const out: string[] = []
  for (let i = 0; i < norm.length - 1; i++) out.push(norm.slice(i, i + 2))
  return out
}

export function relevanceScore(factText: string, context: string): number {
  const normFact = normalizeText(factText)
  const normCtx = normalizeText(context)
  if (!normFact || !normCtx) return 0
  if (normCtx.includes(normFact) || normFact.includes(normCtx)) return 1
  return bm25Score(normFact, normCtx)
}

const RECALL_WEIGHTS = { wSim: 0.4, wValue: 0.3, wDue: 0.3 }
const DUE_WINDOW_DAYS = 14
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}
function valueNormFact(f: MemoryFact): number {
  const substantive = f.source === 'user_statement' || f.confidence >= 0.9
  return substantive ? (f.importance - 1) / 9 : 0
}

function valueNormStory(s: MemoryStory): number {
  return s.kind === 'promise' || s.kind === 'milestone' ? (s.importance - 1) / 9 : 0
}


function dueProximity(dueAt: string | null, now: number): number {
  if (!dueAt) return 0
  const t = new Date(dueAt).getTime()
  if (Number.isNaN(t)) return 0
  const days = (t - now) / 86400000
  if (days < -1 || days > DUE_WINDOW_DAYS) return 0
  return clamp01(1 - Math.max(0, days) / DUE_WINDOW_DAYS)
}

// 记忆块装配核心：分组→打分→预算截断，相关度来源由调用方注入（关键词 / 向量）
function assembleMemoryBlock(
  actives: MemoryFact[],
  activeStoriesList: MemoryStory[],
  charCap: number,
  relOfFact: (f: MemoryFact) => number,
  relOfStory: (s: MemoryStory) => number,
  factScoreScale: number,
): string | null {
  if (actives.length === 0 && activeStoriesList.length === 0) return null

  const now = Date.now()
  const { wSim, wValue, wDue } = RECALL_WEIGHTS
  type Item = { text: string; score: number }
  const groups: Record<'user' | 'character' | 'relationship', Item[]> = {
    user: [],
    character: [],
    relationship: [],
  }
  for (const f of actives) {
    const rel = wSim * relOfFact(f) + wValue * valueNormFact(f) + wDue * dueProximity(f.valid_until ?? null, now)
    const score = factScore(f) * (factScoreScale + rel)
    groups[f.entity].push({ text: f.text.slice(0, 60), score })
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
    const dueText = p.due_at ? p.due_at.slice(0, 10) : ''
    const due = dueText && !Number.isNaN(new Date(p.due_at!).getTime()) ? `（约 ${dueText}）` : ''
    const rel = 0.5 + wValue * valueNormStory(p) + wDue * dueProximity(p.due_at, now)
    relationshipItems.push({ text: `约定：${p.text}${due}（还没兑现）`, score: storyScore(p) * (factScoreScale + rel) })
  }
  for (const s of others) {
    const rel = wSim * relOfStory(s) + wValue * valueNormStory(s) + wDue * dueProximity(s.due_at, now)
    relationshipItems.push({
      text: s.text.slice(0, 60),
      score: storyScore(s) * (factScoreScale + rel),
    })
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

export function buildMemoryBlock(
  facts: MemoryFact[],
  stories: MemoryStory[],
  charCap = config.injectCharCap,
  context?: string,
): string | null {
  return assembleMemoryBlock(
    activeFacts(facts),
    activeStories(stories),
    charCap,
    (f) => (context ? relevanceScore(f.text, context) : 0.5),
    (s) => (context ? relevanceScore(s.text, context) : 0.5),
    0.5,
  )
}

function messageText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'string') return parsed
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
    const content = (parsed as { content?: unknown }).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (part && typeof part === 'object' && 'text' in part) return String(part.text)
          if (part && typeof part === 'object' && 'image_url' in part) return '[图片]'
          return ''
        })
        .filter(Boolean)
        .join(' ')
    }
    return ''
  } catch {
    return raw
  }
}

function formatMessageTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 原话召回：补充 facts/stories 覆盖不到的逐字历史，带时间戳，供模型区分"当年说的"和"刚说的"
export async function recallVerbatim(
  characterId: string,
  query: string,
  charCap = 1500,
): Promise<string | null> {
  if (!query.trim()) return null
  await memoryDbReady()
  const rows = searchMessageContext(characterId, query)
  const lines: string[] = []
  let used = 0
  for (const row of rows) {
    const text = messageText(row.content).trim()
    if (!text) continue
    const line = `[${formatMessageTime(row.ts)}] ${row.role}: ${text}`
    if (used + line.length > charCap) break
    lines.push(line)
    used += line.length
  }
  return lines.length ? `相关历史原话（按时间排列）：\n${lines.join('\n')}` : null
}

export async function getMemoryBlock(
  characterId: string,
  context?: string,
  useVector = false,
  charCap = config.injectCharCap,
): Promise<string | null> {
  const [facts, stories] = await Promise.all([
    loadFactsTyped(characterId),
    loadStoriesTyped(characterId),
  ])
  if (useVector && context) {
    return buildMemoryBlockVector(characterId, facts, stories, context, charCap)
  }
  return buildMemoryBlock(facts, stories, charCap, context)
}

export async function buildMemoryBlockVector(
  characterId: string,
  facts: MemoryFact[],
  stories: MemoryStory[],
  context: string,
  charCap: number,
): Promise<string | null> {
  const actives = activeFacts(facts)
  let vectorHits: Array<{ fact: MemoryFact; similarity: number }> = []
  try {
    const needEmbedding = actives.filter((f) => !f.embedding)
    if (needEmbedding.length > 0) {
      for (const f of needEmbedding) {
        f.embedding = await computeEmbeddingAsync(f.text)
        await memoryDbReady()
        setFactEmbeddingRow(f.id, JSON.stringify(f.embedding))
      }
    }
    vectorHits = await searchSimilarAsync(actives, context, 10, 0.2)
  } catch (err) {
    console.warn(`[memory] 向量检索失败，降级到关键词: ${(err as Error).message}`)
  }
  const hitMap = new Map(vectorHits.map((h) => [h.fact.id, h.similarity]))

  return assembleMemoryBlock(
    actives,
    activeStories(stories),
    charCap,
    (f) => hitMap.get(f.id) ?? relevanceScore(f.text, context),
    (s) => relevanceScore(s.text, context),
    0.3,
  )
}

// 遗忘曲线清理：retention < 0.1 且未冻结/未保护的记忆自动归档
export async function decaySweep(characterId: string): Promise<{ archived: number }> {
  const facts = await loadFactsTyped(characterId)
  let archived = 0
  for (const f of facts) {
    if (f.status !== 'active') continue
    if (f.protected || isFactFrozen(f)) continue
    if (retentionScore(f) < 0.1) {
      if (setFactStatusRow(f.id, 'archived') > 0) archived++
    }
  }
  return { archived }
}

export async function freezeFact(_characterId: string, factId: string): Promise<boolean> {
  await memoryDbReady()
  return setFactFrozenRow(factId, nowIso()) > 0
}

export async function unfreezeFact(_characterId: string, factId: string): Promise<boolean> {
  await memoryDbReady()
  return setFactFrozenRow(factId, null) > 0
}

export async function deleteFact(_characterId: string, factId: string): Promise<boolean> {
  await memoryDbReady()
  return deleteFactRow(factId) > 0
}
