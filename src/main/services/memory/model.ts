import type { MemoryRow } from './types'

export type MemoryKind = 'fact' | 'episode'
export type EpisodeKind = 'event' | 'promise' | 'milestone' | 'joke'
export type MemoryEntity = 'user' | 'character' | 'relationship'
export type MemorySource = 'user_statement' | 'character_statement' | 'llm_inferred' | 'manual'
export type MemoryState = 'active' | 'dormant' | 'superseded' | 'archived' | 'fulfilled'

export interface MemoryEvidence {
  reinforce: number
  negate: number
  fromTs?: number
  toTs?: number
  messageIds?: number[]
}

/** 领域模型：事实与经历是同一张表的两种 kind，不再各自一套类型。 */
export interface Memory {
  id: string
  roleId: string
  kind: MemoryKind
  /** 表里 kind 列同时承载事实/经历与经历子类，读出来时拆成两层。 */
  episodeKind: EpisodeKind | null
  text: string
  entity: MemoryEntity
  subject: string | null
  attribute: string | null
  value: string | null
  negated: boolean
  importance: number
  source: MemorySource
  state: MemoryState
  happenedAt: number | null
  dueAt: string | null
  validFrom: string | null
  invalidAt: string | null
  confirmedAt: number
  evidence: MemoryEvidence
  pinned: boolean
  frozen: boolean
  embedding: number[] | null
  createdAt: number
}

const EMPTY_EVIDENCE: MemoryEvidence = { reinforce: 0, negate: 0 }

/** 旧数据把来源范围直接写在 evidence 里，新数据在同层追加计数；两种都要能读。 */
export function parseEvidence(raw: string | null | undefined): MemoryEvidence {
  if (!raw) return { ...EMPTY_EVIDENCE }
  try {
    const parsed = JSON.parse(raw) as Partial<MemoryEvidence> | null
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_EVIDENCE }
    return {
      reinforce: Number.isFinite(parsed.reinforce) ? Number(parsed.reinforce) : 0,
      negate: Number.isFinite(parsed.negate) ? Number(parsed.negate) : 0,
      fromTs: typeof parsed.fromTs === 'number' ? parsed.fromTs : undefined,
      toTs: typeof parsed.toTs === 'number' ? parsed.toTs : undefined,
      messageIds: Array.isArray(parsed.messageIds) ? parsed.messageIds.map(Number) : undefined,
    }
  } catch {
    return { ...EMPTY_EVIDENCE }
  }
}

export function formatEvidence(evidence: MemoryEvidence): string {
  return JSON.stringify({
    ...(evidence.fromTs !== undefined ? { fromTs: evidence.fromTs } : {}),
    ...(evidence.toTs !== undefined ? { toTs: evidence.toTs } : {}),
    ...(evidence.messageIds ? { messageIds: evidence.messageIds } : {}),
    reinforce: evidence.reinforce,
    negate: evidence.negate,
  })
}

const SOURCES = new Set<MemorySource>(['user_statement', 'character_statement', 'llm_inferred', 'manual'])
const STATES = new Set<MemoryState>(['active', 'dormant', 'superseded', 'archived', 'fulfilled'])
const EPISODE_KINDS = new Set<EpisodeKind>(['event', 'promise', 'milestone', 'joke'])

function asEpisodeKind(value: string | undefined): EpisodeKind | null {
  return EPISODE_KINDS.has(value as EpisodeKind) ? (value as EpisodeKind) : null
}
const ENTITIES = new Set<MemoryEntity>(['user', 'character', 'relationship'])

function asSource(value: string | undefined): MemorySource {
  return SOURCES.has(value as MemorySource) ? (value as MemorySource) : 'llm_inferred'
}

function asEntity(value: string | undefined): MemoryEntity {
  return ENTITIES.has(value as MemoryEntity) ? (value as MemoryEntity) : 'user'
}

function asState(value: string | undefined): MemoryState {
  return STATES.has(value as MemoryState) ? (value as MemoryState) : 'active'
}

function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(Number) : null
  } catch {
    return null
  }
}

export function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    roleId: row.role_id,
    kind: row.kind === 'fact' ? 'fact' : 'episode',
    episodeKind: row.kind === 'fact' ? null : asEpisodeKind(row.kind),
    text: row.text,
    entity: asEntity(row.entity),
    subject: row.subject ?? null,
    attribute: row.attribute ?? null,
    value: row.object ?? null,
    negated: row.polarity === 0,
    importance: row.importance,
    source: asSource(row.source),
    state: asState(row.state),
    happenedAt: row.happened_at,
    dueAt: row.due_at ?? null,
    validFrom: row.valid_from ?? null,
    invalidAt: row.invalid_at ?? null,
    confirmedAt: row.confirmed_at ?? row.created_at,
    evidence: parseEvidence(row.evidence),
    pinned: row.pinned === 1,
    frozen: Boolean(row.frozen_at),
    embedding: parseEmbedding(row.embedding),
    createdAt: row.created_at,
  }
}

export function toRow(memory: Memory): MemoryRow {
  return {
    id: memory.id,
    role_id: memory.roleId,
    kind: memory.kind === 'fact' ? 'fact' : (memory.episodeKind ?? 'event'),
    text: memory.text,
    entity: memory.entity,
    subject: memory.subject,
    attribute: memory.attribute,
    object: memory.value,
    polarity: memory.negated ? 0 : 1,
    confidence: memory.source === 'llm_inferred' ? 0.6 : 1,
    source: memory.source,
    state: memory.state,
    importance: memory.importance,
    happened_at: memory.happenedAt,
    created_at: memory.createdAt,
    confirmed_at: memory.confirmedAt,
    source_from: memory.evidence.fromTs ?? null,
    source_to: memory.evidence.toTs ?? null,
    supersedes: null,
    pinned: memory.pinned || memory.frozen ? 1 : 0,
    embedding: memory.embedding ? JSON.stringify(memory.embedding) : null,
    valid_from: memory.validFrom,
    invalid_at: memory.invalidAt,
    due_at: memory.dueAt,
    frozen_at: memory.frozen ? new Date(memory.confirmedAt).toISOString() : null,
    evidence: formatEvidence(memory.evidence),
  }
}

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

export type Cardinality = 'single' | 'multi'

// 只认单值的谓词：换成别的词一律按多值处理。默认多值是安全方向——最坏留下过期偏好，不会丢真实信息
const SINGLE_PREDICATES = new Set([
  '居住城市', '城市', '所在地', '现居地', '家乡',
  '生日', '出生日期', '年龄', '星座', '血型', '性别',
  '名字', '姓名', '全名', '昵称', '称呼',
  '职业', '工作', '公司', '学校', '专业', '年级',
  '身高', '体重', '手机号', '手机', '邮箱', '住址',
])

export function cardinalityOf(predicate?: string | null): Cardinality {
  const key = normalizeText(predicate ?? '')
  return SINGLE_PREDICATES.has(key) ? 'single' : 'multi'
}

export interface SlotFact {
  id: string
  text?: string
  entity?: string | null
  subject?: string | null
  attribute?: string | null
  object?: string | null
  value?: string | null
  polarity?: number | boolean | null
  source?: string | null
  importance?: number
  confidence?: number
  status?: string
  evidence?: { reinforce: number, negate: number }
  valid_until?: string | null
  created_at?: string | number | null
  createdAt?: number | null
  valid_from?: string | null
  validFrom?: string | null
  last_confirmed_at?: string | null
  confirmedAt?: number | null
  frozen_at?: string | null
  frozen?: boolean | null
}

// 槽位 = 实体 + 主语 + 谓词；缺主语或谓词的老数据各自成槽，不互相合并
export function slotOf(fact: { id: string, entity?: string | null, subject?: string | null, attribute?: string | null }): string {
  const subject = normalizeText(fact.subject ?? '')
  const attribute = normalizeText(fact.attribute ?? '')
  if (!subject || !attribute) return `legacy:${fact.id}`
  return `${fact.entity ?? 'user'}|${subject}|${attribute}`
}

export function isPositive(fact: { polarity?: number | boolean | null }): boolean {
  return fact.polarity === undefined || fact.polarity === null ? true : Boolean(fact.polarity)
}

export function authorityOf(source?: string | null): number {
  if (source === 'user_statement' || source === 'manual') return 1
  if (source === 'character_statement') return 0.75
  return 0.5
}

export function valueOf(fact: SlotFact): string {
  return fact.value ?? fact.object ?? fact.id
}

function epochOf(stamp?: string | number | null): number {
  if (stamp === undefined || stamp === null || stamp === '') return 0
  if (typeof stamp === 'number') return Number.isFinite(stamp) ? stamp : 0
  const parsed = Date.parse(stamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

function atOf(fact: SlotFact): number {
  return epochOf(fact.valid_from)
    || epochOf(fact.validFrom)
    || epochOf(fact.created_at)
    || epochOf(fact.createdAt)
}

function frozenOf(fact: SlotFact): boolean {
  return Boolean(fact.frozen_at || fact.frozen)
}

// 取最新观测；权威更低的后来者（推断）不能覆盖用户原话
function pickLatest<T extends SlotFact>(sorted: T[]): T | undefined {
  const frozen = sorted.filter(frozenOf)
  const pool = frozen.length > 0 ? frozen : sorted
  let best: T | undefined
  for (const fact of pool) {
    if (!best) {
      best = fact
      continue
    }
    if (authorityOf(fact.source) >= authorityOf(best.source)) best = fact
  }
  return best
}

export interface SlotState<T extends SlotFact> {
  slot: string
  attribute: string
  cardinality: Cardinality
  current: T[]
  history: T[]
}

/**
 * 从全部观测里算出「现在成立什么」。
 * 单值谓词只留一条；多值谓词按取值分组各留一条。
 * 否定也是成立的陈述（“不吃香菜”），必须留在 current，否则最该提醒的偏好会被丢掉。
 */
export function resolveCurrent<T extends SlotFact>(facts: T[]): SlotState<T>[] {
  const buckets = new Map<string, T[]>()
  for (const fact of facts) {
    const slot = slotOf(fact)
    const list = buckets.get(slot)
    if (list) list.push(fact)
    else buckets.set(slot, [fact])
  }

  const states: SlotState<T>[] = []
  for (const [slot, rows] of buckets) {
    const firstRow = rows[0]
    const attribute = firstRow?.attribute ?? ''
    const cardinality: Cardinality = slot.startsWith('legacy:') ? 'multi' : cardinalityOf(attribute)
    const sorted = [...rows].sort((a, b) => atOf(a) - atOf(b))
    const current: T[] = []

    if (cardinality === 'single') {
      const winner = pickLatest(sorted)
      if (winner) current.push(winner)
    } else {
      const byValue = new Map<string, T[]>()
      for (const row of sorted) {
        const key = normalizeText(valueOf(row))
        const list = byValue.get(key)
        if (list) list.push(row)
        else byValue.set(key, [row])
      }
      for (const list of byValue.values()) {
        const winner = pickLatest(list)
        if (winner) current.push(winner)
      }
    }

    // 未被采纳的观测都进历史：包括被否定的旧值和被替换的旧值
    const currentIds = new Set(current.map((row) => row.id))
    const history = sorted.filter((row) => !currentIds.has(row.id))
    states.push({ slot, attribute, cardinality, current, history })
  }
  return states
}

export function isExpired(memory: { invalidAt?: string | null }, now = Date.now()): boolean {
  if (!memory.invalidAt) return false
  const expiry = Date.parse(memory.invalidAt)
  return !Number.isNaN(expiry) && expiry <= now
}

export interface RetentionInput {
  frozen?: boolean
  frozen_at?: string | null
  invalidAt?: string | null
  valid_until?: string | null
  confirmedAt?: number
  last_confirmed_at?: string | null
  createdAt?: number
  created_at?: string | null
  importance?: number
}

function hasExpired(memory: RetentionInput, now: number): boolean {
  const stamp = memory.invalidAt ?? memory.valid_until
  if (!stamp) return false
  const expiry = Date.parse(stamp)
  return !Number.isNaN(expiry) && expiry <= now
}

function confirmedStamp(memory: RetentionInput): number {
  if (memory.confirmedAt) return memory.confirmedAt
  return epochOf(memory.last_confirmed_at) || epochOf(memory.created_at) || memory.createdAt || 0
}

/** 新鲜度：按重要度给出不同半衰期（重要度 × 7 天），冻结或钉住的不衰减。 */
export function retentionOf(memory: RetentionInput, now = Date.now()): number {
  if (memory.frozen || memory.frozen_at) return 1
  if (hasExpired(memory, now)) return 0
  const stamp = confirmedStamp(memory)
  if (!stamp) return 1
  const days = Math.max(0, (now - stamp) / 86_400_000)
  const stability = Math.max(1, (memory.importance ?? 5) * 7)
  return Math.max(0, Math.min(1, Math.exp(-days / stability)))
}

export function wantsHistory(text?: string | null): boolean {
  return !!text && HISTORY_HINTS.test(text)
}
