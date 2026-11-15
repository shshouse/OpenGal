import { z } from 'zod'

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

/** 模型输出不可信：字段级容错，非法值退化为缺失，不连累整个 beat。超长按上限截断，不整条丢弃。 */
const text = (max: number) =>
  z.string().transform((s) => s.trim().slice(0, max) || undefined).optional().catch(undefined)

/** 省略值为 undefined 的键，保持与原手写解析一致的输出形状。 */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

const performanceSchema = z
  .object({
    emotion: text(40),
    motion: text(40),
    pace: z.enum(['slow', 'normal', 'fast']).optional().catch(undefined),
  })
  .transform((p) => (p.emotion || p.motion || p.pace ? (compact(p) as BeatPerformance) : undefined))
  .catch(undefined)

const beatSchema = z
  .object({
    intent: z.string().trim().pipe(z.enum(BEAT_INTENTS)),
    target: z.enum(['user', 'self', 'shared']).optional().catch(undefined),
    urgency: z.enum(['low', 'normal', 'high']).catch('normal'),
    performance: performanceSchema,
    brief: text(160),
  })
  .transform((b) => compact(b) as Beat)

/** 解析模型输出里的 beat；非法时返回 undefined，不影响 speak 本身。 */
export function parseBeat(value: unknown): Beat | undefined {
  const parsed = beatSchema.safeParse(value)
  return parsed.success ? (parsed.data as Beat) : undefined
}
