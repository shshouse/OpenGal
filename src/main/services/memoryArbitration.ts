export interface FactLike {
  id: string
  text: string
  entity: string
  subject?: string | null
  attribute?: string | null
  object?: string | null
  polarity?: number | boolean
  status?: string
  source?: string
  importance?: number
  confidence?: number
  created_at?: string
  last_confirmed_at?: string
  valid_from?: string | null
  valid_until?: string | null
  frozen_at?: string | null
  evidence?: { reinforce: number, negate: number }
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

export function cardinalityOf(predicate?: string | null): Cardinality {
  const key = normalizeText(predicate ?? '')
  return SINGLE_PREDICATES.has(key) ? 'single' : 'multi'
}

// 槽位 = 实体 + 主语 + 谓词；缺主语或谓词的老数据各自成槽，不互相合并
export function slotOf(fact: { id: string, entity: string, subject?: string | null, attribute?: string | null }): string {
  const subject = normalizeText(fact.subject ?? '')
  const attribute = normalizeText(fact.attribute ?? '')
  if (!subject || !attribute) return `legacy:${fact.id}`
  return `${fact.entity}|${subject}|${attribute}`
}

export function isPositive(fact: FactLike): boolean {
  return fact.polarity === undefined || fact.polarity === null ? true : Boolean(fact.polarity)
}

export function authorityOf(source?: string): number {
  if (source === 'user_statement' || source === 'manual') return 1
  if (source === 'character_statement') return 0.75
  return 0.5
}

function atOf(fact: FactLike): number {
  const stamp = fact.valid_from || fact.created_at || ''
  const parsed = Date.parse(stamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

// 取最新观测；权威更低的后来者（推断）不能覆盖用户原话
function pickLatest<T extends FactLike>(sorted: T[]): T | undefined {
  const frozen = sorted.filter((fact) => fact.frozen_at)
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

export interface SlotState<T extends FactLike> {
  slot: string
  attribute: string
  cardinality: Cardinality
  current: T[]
  history: T[]
}

/**
 * 从全部观测里算出「现在成立什么」。
 * 单值谓词只留一条；多值谓词按宾语分组各留一条；被否定的宾语不算成立。
 */
export function resolveCurrent<T extends FactLike>(facts: T[]): SlotState<T>[] {
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
    const history: T[] = []

    if (cardinality === 'single') {
      const winner = pickLatest(sorted)
      if (winner && isPositive(winner)) current.push(winner)
    } else {
      const byObject = new Map<string, T[]>()
      for (const row of sorted) {
        const key = normalizeText(row.object ?? row.text)
        const list = byObject.get(key)
        if (list) list.push(row)
        else byObject.set(key, [row])
      }
      for (const list of byObject.values()) {
        const winner = pickLatest(list)
        if (winner && isPositive(winner)) current.push(winner)
      }
    }

    // 未被采纳的观测都进历史：包括被否定的当前值
    const currentIds = new Set(current.map((row) => row.id))
    history.push(...sorted.filter((row) => !currentIds.has(row.id)))

    states.push({ slot, attribute, cardinality, current, history })
  }
  return states
}

export function retentionOf(fact: FactLike, now = Date.now()): number {
  if (fact.frozen_at) return 1
  if (fact.valid_until) {
    const expiry = Date.parse(fact.valid_until)
    if (!Number.isNaN(expiry) && expiry < now) return 0
  }
  const stamp = fact.last_confirmed_at || fact.created_at || ''
  const confirmed = Date.parse(stamp)
  if (Number.isNaN(confirmed)) return 1
  const days = Math.max(0, (now - confirmed) / 86_400_000)
  const stability = Math.max(1, (fact.importance ?? 5) * 7)
  return Math.max(0, Math.min(1, Math.exp(-days / stability)))
}

// 只用于“注入名额”排序：重要度、来源权威、时效、被确认次数。置信度是模型自报的，不参与
export function scoreOf(fact: FactLike, now = Date.now()): number {
  const reinforce = fact.evidence?.reinforce ?? 0
  const evidenceBoost = 1 + Math.min(0.6, 0.15 * Math.log1p(reinforce))
  return (fact.importance ?? 5)
    * authorityOf(fact.source)
    * retentionOf(fact, now)
    * evidenceBoost
}

export function wantsHistory(text?: string | null): boolean {
  return !!text && HISTORY_HINTS.test(text)
}
