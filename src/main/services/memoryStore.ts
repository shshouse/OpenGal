import { randomUUID } from 'node:crypto'
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
  reinforceFactRow,
  setFactFrozenRow,
  setFactEmbeddingRow,
  deleteFactRow,
  searchMessages,
  visibleMessageText,
  getMemoryCursor,
  setMemoryCursor,
  listMessagesAfter,
  listMessageIdsInRange,
  isCursorInitialized,
  markCursorInitialized,
  bootstrapCursor,
  resetDerived,
  listMemoryRows,
  setMemoryStateRow,
  memoryEvidence,
  pruneSummaries,
  type FactRow,
  type StoryRow,
} from './memoryDb.ts'
import { computeEmbeddingAsync, searchSimilarAsync } from './vectorSearch.ts'
import {
  normalizeText,
  resolveCurrent,
  retentionOf,
  scoreOf,
  similarity,
  slotOf,
  wantsHistory,
} from './memoryArbitration.ts'
import { getErrorMessage } from '@shared/errors'

let config: MemoryConfig = {
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
    subject: r.subject ?? null,
    attribute: r.attribute ?? null,
    object: r.object ?? null,
    polarity: r.polarity === 0 ? false : true,
    importance: r.importance,
    confidence: r.confidence,
    source: r.source as MemoryFact['source'],
    created_at: r.created_at,
    last_confirmed_at: r.last_confirmed_at,
    status: r.status as MemoryFact['status'],
    valid_from: r.valid_from ?? null,
    invalid_at: r.invalid_at ?? null,
    superseded_by: r.superseded_by ?? null,
    evidence: { reinforce: r.evidence_reinforce, negate: r.evidence_negate },
    protected: r.protected_ === 1,
    valid_until: r.valid_until ?? null,
    frozen_at: r.frozen_at ?? null,
    embedding: r.embedding ? (JSON.parse(r.embedding) as number[]) : null,
  }
}

function factToRow(f: MemoryFact, sourceEvidence: string | null = null): FactRow {
  return {
    id: f.id,
    character_id: '',
    text: f.text,
    entity: f.entity,
    subject: f.subject ?? null,
    attribute: f.attribute ?? null,
    object: f.object ?? null,
    polarity: f.polarity === false ? 0 : 1,
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
    source_evidence: sourceEvidence,
    valid_from: f.valid_from ?? null,
    invalid_at: f.invalid_at ?? null,
    superseded_by: f.superseded_by ?? null,
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

function storyToRow(s: MemoryStory, sourceEvidence: string | null = null): StoryRow {
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
    source_evidence: sourceEvidence,
  }
}

const MAX_ACTIVE_MEMORIES = 2000

// 超过上限时按重要性归档，钉住的记忆不计入上限也不被归档
export async function pruneOverflow(
  characterId: string,
  limit = MAX_ACTIVE_MEMORIES,
): Promise<{ archived: number }> {
  await memoryDbReady()
  pruneSummaries(characterId)
  const rows = listMemoryRows(characterId)
  if (rows.length <= limit) return { archived: 0 }
  const pinned = rows.filter((row) => row.pinned === 1)
  const rest = rows
    .filter((row) => row.pinned !== 1)
    .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
  const room = Math.max(0, limit - pinned.length)
  const drop = rest.slice(room)
  for (const row of drop) setMemoryStateRow(row.id, 'archived')
  return { archived: drop.length }
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

export { normalizeText, similarity as textSimilarity }

let lastStamp = 0

// 同一毫秒内的两次写入也要有先后，否则解析器分不出哪条更新
function nowIso(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1)
  return new Date(lastStamp).toISOString()
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

export function retentionScore(f: MemoryFact): number {
  return retentionOf(f)
}

export function factScore(f: MemoryFact): number {
  return scoreOf(f)
}

export function storyScore(s: MemoryStory): number {
  const kindWeight = s.kind === 'milestone' ? 1.3 : s.kind === 'promise' ? 1.2 : s.kind === 'joke' ? 0.9 : 1
  return s.importance * kindWeight
}

function activeStories(stories: MemoryStory[]): MemoryStory[] {
  return stories.filter((s) => s.status === 'active')
}

// 现在成立什么，不存状态，读的时候算
function currentFactsFrom(facts: MemoryFact[]): { current: MemoryFact[], history: MemoryFact[] } {
  const states = resolveCurrent(facts)
  return {
    current: states.flatMap((state) => state.current),
    history: states.flatMap((state) => state.history),
  }
}

function isSamePolarity(a: MemoryFact, b: MemoryFact): boolean {
  return (a.polarity ?? true) === (b.polarity ?? true)
}

function buildFactFromCandidate(cand: MemoryCandidateFact, ts: string): MemoryFact {
  const source: MemoryFact['source'] = cand.attributed_to === 'user'
    ? 'user_statement'
    : cand.attributed_to === 'character'
      ? 'character_statement'
      : cand.attributed_to === 'inferred'
        ? 'llm_inferred'
        : cand.confidence >= 1 ? 'user_statement' : 'llm_inferred'
  const raw = Math.min(1, Math.max(0.1, cand.confidence))
  // 推断不能和用户原话同级：压到 0.6 以下，排序时自然让位
  const confidence = source === 'llm_inferred' ? Math.min(raw, 0.6) : raw
  return {
    id: newId('f'),
    text: cand.text.trim(),
    entity: cand.entity,
    subject: cand.subject?.trim() || null,
    attribute: cand.attribute?.trim() || null,
    object: cand.object?.trim() || null,
    polarity: cand.polarity !== false,
    importance: Math.min(10, Math.max(1, Math.round(cand.importance))),
    confidence,
    source,
    created_at: ts,
    last_confirmed_at: ts,
    status: 'active',
    valid_from: ts,
    invalid_at: null,
    superseded_by: null,
    evidence: { reinforce: 0, negate: 0 },
    protected: false,
    valid_until: cand.valid_until ?? null,
    frozen_at: cand.frozen ? ts : null,
    embedding: null,
  }
}

export interface ApplyResult {
  insertedFacts: number
  refreshedFacts: number
  insertedStories: number
}

export async function applyCandidates(
  characterId: string,
  payload: MemoryApplyPayload,
): Promise<ApplyResult> {
  const facts = await loadFactsTyped(characterId)
  const stories = await loadStoriesTyped(characterId)
  const result: ApplyResult = { insertedFacts: 0, refreshedFacts: 0, insertedStories: 0 }
  const ts = nowIso()
  const sourceEvidence = payload.evidence
    ? JSON.stringify({
        ...payload.evidence,
        messageIds: listMessageIdsInRange(characterId, payload.evidence.fromTs, payload.evidence.toTs),
      })
    : null

  for (const cand of (payload.facts ?? []).filter((item) => item.text?.trim())) {
    const entry = buildFactFromCandidate(cand, ts)
    const slot = slotOf(entry)
    // 只处理“同一件事又说了一遍”：同槽位、同极性、几乎同一句话。其余一律追加
    const repeated = facts.find((fact) =>
      slotOf(fact) === slot
      && isSamePolarity(fact, entry)
      && similarity(fact.text, entry.text) >= 0.9
    )
    if (repeated) {
      await memoryDbReady()
      reinforceFactRow(repeated.id, ts)
      repeated.last_confirmed_at = ts
      repeated.evidence.reinforce += 1
      result.refreshedFacts++
      continue
    }
    facts.push(entry)
    insertFactRow(characterId, factToRow(entry, sourceEvidence))
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
    stories.push(entry)
    insertStoryRow(characterId, storyToRow(entry, sourceEvidence))
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
    valid_from: ts,
    invalid_at: null,
    superseded_by: null,
    evidence: { reinforce: 0, negate: 0 },
    protected: true,
    valid_until: null,
    frozen_at: null,
    embedding: null,
  }
  await memoryDbReady()
  insertFactRow(characterId, factToRow(entry, null))
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
  // 已知近似：avgdl 用文档自身长度代替语料平均长度，长度归一化恒为 1，退化为纯 tf 加权；单机够用
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

function uniqueHistory(facts: MemoryFact[]): MemoryFact[] {
  const seen = new Set<string>()
  return [...facts]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .filter((fact) => {
      const key = normalizeText(fact.text)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

// 记忆块装配核心：槽位去重→分组→打分→预算截断；失效记忆只在问及过去时出现
function assembleMemoryBlock(
  actives: MemoryFact[],
  activeStoriesList: MemoryStory[],
  historic: MemoryFact[],
  wantHistory: boolean,
  charCap: number,
  relOfFact: (f: MemoryFact) => number,
  relOfStory: (s: MemoryStory) => number,
  factScoreScale: number,
): string | null {
  const past = wantHistory ? uniqueHistory(historic).slice(0, 5) : []
  if (actives.length === 0 && activeStoriesList.length === 0 && past.length === 0) return null

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

  relationshipItems.push(...groups.relationship)

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
  if (past.length > 0) {
    const pastLines: string[] = []
    for (const fact of past) {
      const text = fact.text.slice(0, 60)
      if (total + text.length > charCap) break
      total += text.length
      pastLines.push(text)
    }
    if (pastLines.length > 0) kept.push(`以前记下的（可能已过时）：${pastLines.join('；')}`)
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
  const { current, history } = currentFactsFrom(facts)
  return assembleMemoryBlock(
    current,
    activeStories(stories),
    history,
    wantsHistory(context),
    charCap,
    (f) => (context ? relevanceScore(f.text, context) : 0.5),
    (s) => (context ? relevanceScore(s.text, context) : 0.5),
    0.5,
  )
}


const BOOTSTRAP_LOOKBACK = 200

export interface PendingEntry {
  role: 'user' | 'assistant'
  text: string
  at: number
}

// 启动时把库里还没提取的原文带回内存缓冲：崩溃/退出的会话也能补记
export async function pendingFromArchive(
  characterId: string,
  limit = 200,
): Promise<{ cursor: number, entries: PendingEntry[] }> {
  await memoryDbReady()
  let cursor = getMemoryCursor(characterId)
  if (!isCursorInitialized(characterId)) {
    cursor = bootstrapCursor(characterId, BOOTSTRAP_LOOKBACK)
    setMemoryCursor(characterId, cursor)
    markCursorInitialized(characterId)
  }
  const entries: PendingEntry[] = []
  for (const row of listMessagesAfter(characterId, cursor, limit)) {
    const text = visibleMessageText(row.content).trim()
    if (!text) continue
    const role: PendingEntry['role'] = row.role === 'user' ? 'user' : 'assistant'
    entries.push({ role, text: text.slice(0, role === 'user' ? 500 : 300), at: row.ts })
  }
  return { cursor, entries }
}

export async function advanceCursor(characterId: string, ts: number): Promise<void> {
  await memoryDbReady()
  if (ts > getMemoryCursor(characterId)) setMemoryCursor(characterId, ts)
  markCursorInitialized(characterId)
}

// 清空派生数据并从零重放；原文与聊天记录一条不动。必须显式传确认标记
export async function rebuildMemory(
  characterId: string,
  confirm: string,
): Promise<{ facts: number, stories: number }> {
  if (confirm !== `rebuild:${characterId}`) throw new Error(`重建需要确认标记 rebuild:${characterId}`)
  await memoryDbReady()
  const removed = resetDerived(characterId)
  setMemoryCursor(characterId, 0)
  markCursorInitialized(characterId)
  return removed
}

function formatMessageTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 原话召回：补充 facts/stories 覆盖不到的逐字历史，带时间戳，供模型区分"当年说的"和"刚说的"
// 词法没命中时退回记忆向量：命中的事实再展开成当时的原话
async function recallFromMemoryVectors(
  characterId: string,
  query: string,
  charCap: number,
): Promise<string | null> {
  const facts = (await loadFactsTyped(characterId)).filter((fact) => fact.status === 'active')
  if (facts.length === 0) return null
  let hits: Array<{ fact: MemoryFact; similarity: number }>
  try {
    hits = await searchSimilarAsync(facts, query, 3, 0.35)
  } catch {
    return null
  }
  if (hits.length === 0) return null
  const lines: string[] = []
  let used = 0
  for (const hit of hits) {
    for (const row of memoryEvidence(characterId, hit.fact.id, 2)) {
      const text = visibleMessageText(row.content).trim()
      if (!text) continue
      const line = `[${formatMessageTime(row.ts)}] ${row.role}: ${text}`
      if (used + line.length > charCap) break
      lines.push(line)
      used += line.length
    }
  }
  if (lines.length === 0) {
    return hits.map((hit) => `[记忆] ${hit.fact.text}`).join('\n')
  }
  return `相关历史原话（按时间排列）：\n${lines.join('\n')}`
}

export async function recallVerbatim(
  characterId: string,
  query: string,
  charCap = 1500,
  range?: { fromTs: number; toTs: number },
): Promise<string | null> {
  if (!query.trim()) return null
  await memoryDbReady()
  const rows = searchMessages(characterId, query, { fromTs: range?.fromTs, toTs: range?.toTs, radius: 1 })
  if (rows.length === 0) return recallFromMemoryVectors(characterId, query, charCap)
  const lines: string[] = []
  let used = 0
  for (const row of rows) {
    const text = visibleMessageText(row.content).trim()
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
  const { current: actives, history } = currentFactsFrom(facts)
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
    console.warn(`[memory] 向量检索失败，降级到关键词: ${getErrorMessage(err)}`)
  }
  const hitMap = new Map(vectorHits.map((h) => [h.fact.id, h.similarity]))

  return assembleMemoryBlock(
    actives,
    activeStories(stories),
    history,
    wantsHistory(context),
    charCap,
    (f) => hitMap.get(f.id) ?? relevanceScore(f.text, context),
    (s) => relevanceScore(s.text, context),
    0.3,
  )
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
