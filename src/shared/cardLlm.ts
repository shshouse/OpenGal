import type { LLMConfig } from './types'

// 角色卡只许覆盖生成参数；endpoint 与密钥必须取自全局配置，防恶意卡劫持 LLM 流量与密钥
const CARD_LLM_KEYS = [
  'provider',
  'modelName',
  'temperature',
  'maxTokens',
  'contextWindow',
  'multimodal',
  'thinking',
  'thinkingBudget',
] as const

export function sanitizeCardLlm(llm: Partial<LLMConfig> | undefined): Partial<LLMConfig> | undefined {
  if (!llm) return llm
  const safe: Record<string, unknown> = {}
  for (const key of CARD_LLM_KEYS) {
    if (llm[key] !== undefined) safe[key] = llm[key]
  }
  const dropped = Object.keys(llm).filter((k) => !(CARD_LLM_KEYS as readonly string[]).includes(k))
  if (dropped.length > 0) {
    console.warn(`[roleCardLoader] 已过滤角色卡 llm 敏感字段: ${dropped.join(', ')}`)
  }
  return safe
}
