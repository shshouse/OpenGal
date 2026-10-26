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
  supersedeFactRow,
  setFactFrozenRow,
  setFactEmbeddingRow,
  deleteFactRow,
  searchMessageContext,
  searchMessagesInRange,
  type FactRow,
  type StoryRow,
} from './memoryDb.ts'
import { computeEmbeddingAsync, searchSimilarAsync } from './vectorSearch.ts'
import {
  decide,
  normalizeText,
  parseVerdict,
  pickTarget,
  retentionOf,
  sameSlotDedupe,
  scoreOf,
  similarity,
  wantsHistory,
  type MemoryVerdict,
} from './memoryArbitration.ts'

export type FactJudge = (
  pairs: Array<{ index: number, target: MemoryFact, candidate: MemoryCandidateFact }>,
) => Promise<Array<{ index: number, verdict: MemoryVerdict }>>

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

function activeFacts(facts: MemoryFact[]): MemoryFact[] {
  return facts.filter((f) => f.status === 'active' && !isFactExpired(f))
}

function activeStories(stories: MemoryStory[]): MemoryStory[] {
  return stories.filter((s) => s.status === 'active')
}

// 失效但未删除的记忆：可被“以前/上次”这类问法召回，不再默认注入
function historyFacts(facts: MemoryFact[]): MemoryFact[] {
  return facts
    .filter((f) => f.status === 'superseded' || f.status === 'archived')
    .sort((a, b) => (b.invalid_at ?? b.created_at).localeCompare(a.invalid_at ?? a.created_at))
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
  supersededFacts: number
  judgedAway: number
  insertedStories: number
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
    supersededFacts: 0,
    judgedAway: 0,
    insertedStories: 0,
  }
  const ts = nowIso()
  const sourceEvidence = payload.evidence ? JSON.stringify(payload.evidence) : null
  const candidates = (payload.facts ?? []).filter((cand) => cand.text?.trim())

  // 一个批次只调一次裁判：先按槽位/相似度找出可能相关的旧记忆
  const targets = new Map<number, MemoryFact>()
  const pairs: Array<{ index: number, target: MemoryFact, candidate: MemoryCandidateFact }> = []
  candidates.forEach((candidate, index) => {
    const hit = pickTarget(candidate, activeFacts(facts))
    if (!hit) return
    targets.set(index, hit.target)
    pairs.push({ index, target: hit.target, candidate })
  })

  const verdicts = new Map<number, MemoryVerdict>()
  if (pairs.length > 0) {
    try {
      const answered = judge ? await judge(pairs) : []
      for (const item of answered) verdicts.set(item.index, parseVerdict(item.verdict))
    } catch {
      // 裁判不可用：全部按新信息写入。宁可有重复，也不默认强化旧记忆
    }
  }

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]
    const target = targets.get(index)
    const action = target ? decide(verdicts.get(index) ?? 'unrelated') : 'insert'

    if (!target || action === 'insert') {
      const entry = buildFactFromCandidate(candidate, ts)
      facts.push(entry)
      insertFactRow(characterId, factToRow(entry, sourceEvidence))
      result.insertedFacts++
      continue
    }

    // 裁判 await 期间用户可能已删除或冻结这条记忆，以库里的最新状态为准
    const freshRow = getFactRow(target.id)
    if (!freshRow) {
      result.judgedAway++
      continue
    }
    const fresh = rowToFact(freshRow)
    if (action === 'reinforce') {
      reinforceFactRow(fresh.id, ts)
      const local = facts.find((item) => item.id === fresh.id)
      if (local) {
        local.last_confirmed_at = ts
        local.evidence.reinforce += 1
      }
      result.refreshedFacts++
      continue
    }

    // 用户明确要求「记住」的记忆不被改写，但新信息也不丢：并存，注入时钉住的优先
    if (fresh.frozen_at) {
      const pinned = buildFactFromCandidate(candidate, ts)
      facts.push(pinned)
      insertFactRow(characterId, factToRow(pinned, sourceEvidence))
      result.insertedFacts++
      continue
    }

    const entry = buildFactFromCandidate(candidate, ts)
    supersedeFactRow(fresh.id, ts, entry.id)
    const local = facts.find((item) => item.id === fresh.id)
    if (local) {
      local.status = 'superseded'
      local.invalid_at = ts
      local.superseded_by = entry.id
      local.evidence.negate += 1
    }
    facts.push(entry)
    insertFactRow(characterId, factToRow(entry, sourceEvidence))
    result.insertedFacts++
    result.supersededFacts++
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
  const past = wantHistory ? historic.slice(0, 5) : []
  if (actives.length === 0 && activeStoriesList.length === 0 && past.length === 0) return null

  const now = Date.now()
  const { wSim, wValue, wDue } = RECALL_WEIGHTS
  type Item = { text: string; score: number }
  const groups: Record<'user' | 'character' | 'relationship', Item[]> = {
    user: [],
    character: [],
    relationship: [],
  }
  for (const f of sameSlotDedupe(actives)) {
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
  return assembleMemoryBlock(
    activeFacts(facts),
    activeStories(stories),
    historyFacts(facts),
    wantsHistory(context),
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
  range?: { fromTs: number; toTs: number },
): Promise<string | null> {
  if (!query.trim()) return null
  await memoryDbReady()
  const rows = range
    ? searchMessagesInRange(characterId, query, range.fromTs, range.toTs)
    : searchMessageContext(characterId, query)
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
    historyFacts(facts),
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
