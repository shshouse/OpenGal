export interface MemoryDbLogger {
  info(source: string, message: string): void
  warn(source: string, message: string): void
  error(source: string, message: string): void
}

export interface MessageRow {
  id?: number
  character_id: string
  role: string
  content: string
  ts: number
  archived: number
  kind?: string
}

export interface MemoryRow {
  id: string
  character_id: string
  kind: string
  text: string
  subject?: string | null
  attribute?: string | null
  object?: string | null
  polarity?: number | null
  entity?: string
  confidence?: number
  source?: string
  state: string
  importance: number
  happened_at: number | null
  created_at: number
  confirmed_at?: number | null
  source_from: number | null
  source_to: number | null
  supersedes: string | null
  pinned: number
  embedding: string | null
  valid_from?: string | null
  invalid_at?: string | null
  due_at?: string | null
  frozen_at?: string | null
  evidence?: string | null
}

export interface FactRow {
  id: string
  character_id: string
  text: string
  entity: string
  subject: string | null
  attribute: string | null
  importance: number
  confidence: number
  source: string
  created_at: string
  last_confirmed_at: string
  status: string
  evidence_reinforce: number
  evidence_negate: number
  protected_: number
  valid_until: string | null
  frozen_at: string | null
  embedding: string | null
  source_evidence: string | null
  valid_from?: string | null
  invalid_at?: string | null
  superseded_by?: string | null
  object?: string | null
  polarity?: number | null
}

export interface StoryRow {
  id: string
  character_id: string
  kind: string
  text: string
  occurred_at: string
  due_at: string | null
  fulfilled: number
  importance: number
  status: string
  created_at: string
  source_evidence: string | null
}

export interface MessageSearchOptions {
  fromTs?: number
  toTs?: number
  limit?: number
  radius?: number
}


export interface SummaryRow {
  start_ts: number
  end_ts: number
  text: string
  message_count: number
}
