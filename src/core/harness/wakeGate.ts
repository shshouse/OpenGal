export interface WakeGateInput {
  utterance: string
  now: number
  activeUntil: number
  roleNames: readonly string[]
  requireWakeWord: boolean
  windowMs?: number
}

export interface WakeGateDecision {
  allowed: boolean
  reason: 'direct' | 'wake-word' | 'active-window' | 'ignored'
  nextActiveUntil: number
  cleanedUtterance: string
}

const DEFAULT_ACTIVE_WINDOW_MS = 30_000
const STRIP_PUNCT_RE = /[\s,，.。!！?？~～、:：;；"'“”‘’()（）[\]【】·-]+/g

function normalizeToken(text: string): string {
  return text.replace(STRIP_PUNCT_RE, '').toLowerCase()
}

export function evaluateWakeGate(input: WakeGateInput): WakeGateDecision {
  const windowMs = input.windowMs ?? DEFAULT_ACTIVE_WINDOW_MS
  const trimmed = input.utterance.trim()
  if (!trimmed) {
    return {
      allowed: false,
      reason: 'ignored',
      nextActiveUntil: input.activeUntil,
      cleanedUtterance: '',
    }
  }

  if (!input.requireWakeWord) {
    return {
      allowed: true,
      reason: 'direct',
      nextActiveUntil: input.now + windowMs,
      cleanedUtterance: trimmed,
    }
  }

  const normalizedUtterance = normalizeToken(trimmed)
  const validNames = input.roleNames
    .map((n) => n.trim())
    .filter((n) => n.length >= 1)
    .sort((a, b) => b.length - a.length)

  for (const rawName of validNames) {
    const target = normalizeToken(rawName)
    if (!target) continue
    if (normalizedUtterance.includes(target)) {
      return {
        allowed: true,
        reason: 'wake-word',
        nextActiveUntil: input.now + windowMs,
        cleanedUtterance: trimmed,
      }
    }
  }

  if (input.now <= input.activeUntil) {
    return {
      allowed: true,
      reason: 'active-window',
      nextActiveUntil: input.now + windowMs,
      cleanedUtterance: trimmed,
    }
  }

  return {
    allowed: false,
    reason: 'ignored',
    nextActiveUntil: input.activeUntil,
    cleanedUtterance: trimmed,
  }
}
