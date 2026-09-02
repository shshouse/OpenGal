import type { LLMUsage } from '@shared/types'

export function normalizeOpenAIUsage(
  u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined,
): LLMUsage | null {
  if (!u || typeof u.prompt_tokens !== 'number' || typeof u.completion_tokens !== 'number') return null
  const total =
    typeof u.total_tokens === 'number' ? u.total_tokens : u.prompt_tokens + u.completion_tokens
  return { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, totalTokens: total }
}
