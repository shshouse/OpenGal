// 导演层契约：解析失败一律 silent；外部内容强制不可信；perHour<=0 表示不限。

// ---------------------------------------------------------------- 感知

export type PerceptionKind = 'utterance' | 'screen' | 'app' | 'touch' | 'web' | 'idle'

interface PerceptionBase {
  id: string
  kind: PerceptionKind
  /** 事件发生时间（epoch ms） */
  at: number
  /** 超过 at + ttlMs 就不再算「此刻知道的事」 */
  ttlMs: number
  /** 外部内容一律 false */
  trusted: boolean
}

export type PerceptionEvent =
  | (PerceptionBase & {
      kind: 'utterance'
      text: string
      confidence?: number
      addressee: 'her' | 'ambient'
    })
  | (PerceptionBase & { kind: 'screen'; summary: string; changed: boolean })
  | (PerceptionBase & { kind: 'app'; name: string; title?: string; fullscreen?: boolean })
  | (PerceptionBase & { kind: 'touch'; how: 'poke' | 'pat' | 'drag' | 'drop' | 'hover'; count?: number })
  | (PerceptionBase & { kind: 'web'; site: string; title: string; excerpt: string; untrusted: true })
  | (PerceptionBase & { kind: 'idle'; sinceMs: number })

// ---------------------------------------------------------------- 输入

export interface DirectorSelf {
  /** 'idle' | 'speaking' | 'thinking' | 'looking-at-screen' */
  doing: string
  mood?: string
  lastSpokeAt?: number
  /** 安静模式截止时间 */
  quietUntil?: number
}

export interface DirectorConstraints {
  /** 本小时剩余主动次数；预算未启用时为 Infinity */
  proactiveBudgetLeft: number
  canInterrupt: boolean
  userFocused: boolean
}

export interface DirectorInput {
  now: number
  character: { id: string; displayName: string }
  self: DirectorSelf
  perception: PerceptionEvent[]
  constraints: DirectorConstraints
}

// ---------------------------------------------------------------- 输出

export type DirectorAction =
  | { type: 'silent'; why: string }
  | { type: 'speak'; interrupt?: boolean; line?: string }
  | { type: 'wait'; waitSec: number; why: string }
  // 以下为保留动作，当前版本按 silent 处理
  | { type: 'emote'; name: string }
  | { type: 'move'; target: string }
  | { type: 'ask'; text: string; options?: string[] }
  | { type: 'browse'; goal: string; maxPages: number; maxSeconds: number }

export interface DirectorDecision {
  action: DirectorAction
  reason: string
  urgency: 'low' | 'normal' | 'high'
}

// ---------------------------------------------------------------- 纯函数

export function framePerception(events: PerceptionEvent[], now: number, limit = 40): PerceptionEvent[] {
  return events
    .filter((e) => now - e.at <= e.ttlMs)
    .sort((a, b) => a.at - b.at)
    .slice(-limit)
}

/** 外部内容永远不算可信，无论调用方传了什么 */
export function sanitizeTrust(event: PerceptionEvent): PerceptionEvent {
  if (event.kind === 'web' || event.kind === 'screen') return { ...event, trusted: false }
  return event
}

const LEGACY_ACTION: Record<string, string> = {
  respond: 'speak',
  silence: 'silent',
  wait: 'wait',
}

function clampWaitSec(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 5
  return Math.min(Math.max(Math.round(n), 2), 15)
}

/**
 * 解析导演输出。永不抛出：任何异常或未知动作都返回 silent。
 */
export function parseDirectorDecision(raw: string): DirectorDecision {
  const silent = (why: string): DirectorDecision => ({
    action: { type: 'silent', why },
    reason: why,
    urgency: 'low',
  })
  if (!raw || typeof raw !== 'string') return silent('empty-output')
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return silent('unparsable-output')

  let parsed: Record<string, unknown>
  try {
    const value = JSON.parse(match[0])
    if (!value || typeof value !== 'object' || Array.isArray(value)) return silent('invalid-json-shape')
    parsed = value as Record<string, unknown>
  } catch {
    return silent('invalid-json')
  }

  const rawAction = String(parsed.action ?? '').trim()
  const actionType = LEGACY_ACTION[rawAction] ?? rawAction
  const reason = String(parsed.reason ?? '').slice(0, 200)
  const urgency = parsed.urgency === 'high' || parsed.urgency === 'low' ? parsed.urgency : 'normal'

  switch (actionType) {
    case 'speak': {
      const line = typeof parsed.line === 'string' ? parsed.line.trim().slice(0, 200) : ''
      return {
        action: { type: 'speak', interrupt: parsed.interrupt === true, ...(line ? { line } : {}) },
        reason,
        urgency,
      }
    }
    case 'wait':
      return {
        action: { type: 'wait', waitSec: clampWaitSec(parsed.waitSec), why: reason },
        reason,
        urgency,
      }
    case 'silent':
      return { action: { type: 'silent', why: reason || 'model-silent' }, reason, urgency }
    case 'emote':
    case 'move':
    case 'ask':
    case 'browse':
      // 保留动作尚未接入执行层，降级为沉默并保留原因，便于发现模型提前使用新动作
      return { action: { type: 'silent', why: `reserved-action:${actionType}` }, reason, urgency }
    default:
      return silent(`unknown-action:${rawAction || 'none'}`)
  }
}

export function describeAction(action: DirectorAction): string {
  switch (action.type) {
    case 'silent':
      return `silent(${action.why})`
    case 'speak':
      return action.interrupt ? 'speak(interrupt)' : 'speak'
    case 'wait':
      return `wait(${action.waitSec}s)`
    default:
      return action.type
  }
}

// ---------------------------------------------------------------- 主动性预算

export interface ProactiveBudgetOptions {
  /** 每小时允许的主动次数；<= 0 表示不限 */
  perHour: number
  cooldownMs: number
}

export interface ProactiveBudget {
  take(now: number): boolean
  refund(): void
  remaining(now: number): number
  reset(now: number): void
}

export function createProactiveBudget(opts: ProactiveBudgetOptions): ProactiveBudget {
  const unlimited = opts.perHour <= 0
  let windowStart = 0
  let used = 0
  let lastTakeAt = 0
  return {
    take(now) {
      if (unlimited) return true
      if (!windowStart || now - windowStart >= 3_600_000) {
        windowStart = now
        used = 0
      }
      if (used >= opts.perHour) return false
      if (lastTakeAt && now - lastTakeAt < opts.cooldownMs) return false
      used += 1
      lastTakeAt = now
      return true
    },
    refund() {
      if (unlimited) return
      if (used > 0) used -= 1
      lastTakeAt = 0
    },
    remaining(now) {
      if (unlimited) return Number.POSITIVE_INFINITY
      if (!windowStart || now - windowStart >= 3_600_000) return opts.perHour
      return Math.max(0, opts.perHour - used)
    },
    reset(now) {
      windowStart = now
      used = 0
      lastTakeAt = 0
    },
  }
}

/** 安静模式与预算优先于导演意愿 */
export function isActionAllowed(
  action: DirectorAction,
  input: Pick<DirectorInput, 'self' | 'constraints'>,
  now = Date.now(),
): boolean {
  if (action.type === 'silent' || action.type === 'wait') return true
  if (input.self.quietUntil && now < input.self.quietUntil) return false
  if (action.type === 'speak') {
    if (input.constraints.proactiveBudgetLeft <= 0) return false
    if (action.interrupt && !input.constraints.canInterrupt) return false
  }
  return true
}
