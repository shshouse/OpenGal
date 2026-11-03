/**
 * 语音门控：确定性 Fast Path。
 *
 * 顺序即优先级：冷却 > 太短 > 忙。先命中先返回，不调用模型。
 */
export type GateSkip = 'cooldown' | 'short' | 'busy'

export interface UtteranceGateInput {
  text: string
  now: number
  lastReplyAt: number
  cooldownSec: number
  isSending: boolean
  minChars?: number
}

export type GateDecision = { allow: true } | { allow: false; skipWhy: GateSkip }

export function gateUtterance(input: UtteranceGateInput): GateDecision {
  if (input.cooldownSec > 0 && input.now - input.lastReplyAt < input.cooldownSec * 1000) {
    return { allow: false, skipWhy: 'cooldown' }
  }
  const compact = input.text.replace(/[\s，。？！,.?！]/g, '')
  if (compact.length < (input.minChars ?? 2)) {
    return { allow: false, skipWhy: 'short' }
  }
  if (input.isSending) return { allow: false, skipWhy: 'busy' }
  return { allow: true }
}
