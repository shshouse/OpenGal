/** 一拍表演意图。导演决定"这一拍做什么"，表达层决定"用她的嘴怎么说"。 */
export const BEAT_INTENTS = [
  'comfort',
  'tease',
  'inform',
  'ask',
  'recall',
  'propose',
  'acknowledge',
  'idle',
] as const

export type BeatIntent = (typeof BEAT_INTENTS)[number]
export type BeatTarget = 'user' | 'self' | 'shared'
export type BeatUrgency = 'low' | 'normal' | 'high'

export interface BeatPerformance {
  emotion?: string
  motion?: string
  pace?: 'slow' | 'normal' | 'fast'
}

export interface Beat {
  intent: BeatIntent
  target?: BeatTarget
  urgency: BeatUrgency
  performance?: BeatPerformance
  /** 给表达层的一句话意图，不是台词 */
  brief?: string
}

function isBeatIntent(value: string): value is BeatIntent {
  return (BEAT_INTENTS as readonly string[]).includes(value)
}

function parsePerformance(value: unknown): BeatPerformance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const emotion = typeof raw.emotion === 'string' ? raw.emotion.trim().slice(0, 40) : ''
  const motion = typeof raw.motion === 'string' ? raw.motion.trim().slice(0, 40) : ''
  const pace = raw.pace === 'slow' || raw.pace === 'fast' ? raw.pace : raw.pace === 'normal' ? 'normal' : undefined
  if (!emotion && !motion && !pace) return undefined
  return {
    ...(emotion ? { emotion } : {}),
    ...(motion ? { motion } : {}),
    ...(pace ? { pace } : {}),
  }
}

/** 解析模型输出里的 beat；非法时返回 undefined，不影响 speak 本身。 */
export function parseBeat(value: unknown): Beat | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const intent = typeof raw.intent === 'string' ? raw.intent.trim() : ''
  if (!isBeatIntent(intent)) return undefined
  const urgency: BeatUrgency =
    raw.urgency === 'low' || raw.urgency === 'high' ? raw.urgency : 'normal'
  const target: BeatTarget | undefined =
    raw.target === 'user' || raw.target === 'self' || raw.target === 'shared' ? raw.target : undefined
  const brief = typeof raw.brief === 'string' ? raw.brief.trim().slice(0, 160) : ''
  const performance = parsePerformance(raw.performance)
  return {
    intent,
    urgency,
    ...(target ? { target } : {}),
    ...(brief ? { brief } : {}),
    ...(performance ? { performance } : {}),
  }
}
