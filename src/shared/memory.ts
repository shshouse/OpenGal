export interface MemoryFact {
  id: string
  text: string
  entity: 'user' | 'character' | 'relationship'
  // 主语 + 属性构成槽位：同一槽位的新值会替代旧值，而不是并列
  subject?: string | null
  attribute?: string | null
  object?: string | null
  // true=肯定陈述，false=否定陈述（“不喜欢咖啡”）
  polarity?: boolean
  importance: number
  confidence: number
  source: 'user_statement' | 'character_statement' | 'llm_inferred' | 'manual'
  created_at: string
  last_confirmed_at: string
  status: 'active' | 'superseded' | 'archived'
  valid_from?: string | null
  invalid_at?: string | null
  superseded_by?: string | null
  evidence: { reinforce: number; negate: number }
  protected?: boolean
  valid_until: string | null
  frozen_at: string | null
  embedding: number[] | null
}

export interface MemoryStory {
  id: string
  kind: 'event' | 'promise' | 'milestone' | 'joke'
  text: string
  occurred_at: string
  due_at: string | null
  fulfilled: boolean
  importance: number
  status: 'active' | 'archived'
  created_at: string
}

export interface MemoryChange {
  seq: number
  memory_id: string
  character_id: string
  action: 'insert' | 'update' | 'delete'
  field: string | null
  old_value: string | null
  new_value: string | null
  actor: string
  reason: string | null
  ts: number
}

export interface MemoryCandidateFact {
  text: string
  entity: MemoryFact['entity']
  subject?: string | null
  attribute?: string | null
  object?: string | null
  polarity?: boolean
  // 这条信息是谁说的：决定它的可信级别，推断不能覆盖用户原话
  attributed_to?: 'user' | 'character' | 'inferred'
  importance: number
  confidence: number
  reason: string
  valid_until?: string | null
  frozen?: boolean
}

export interface MemoryCandidateStory {
  kind: MemoryStory['kind']
  text: string
  importance: number
  reason: string
  due_at?: string | null
}

export interface MemoryApplyPayload {
  facts: MemoryCandidateFact[]
  stories: MemoryCandidateStory[]
  // 这批候选来自哪段对话；写入时记录为来源证据，用于回查原话
  evidence?: { fromTs: number; toTs: number }
}
