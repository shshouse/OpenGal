import type { ChatMessage } from '@shared/types'
import { useLogsStore } from '@/features/logs/logsStore'

export interface ContextUsage {
  systemTokens: number
  memoryTokens: number
  historyTokens: number
  totalTokens: number
  maxTokens: number
}

export function messageText(m: ChatMessage): string {
  return typeof m.content === 'string'
    ? m.content
    : m.content.map((p) => (p.type === 'text' ? p.text : '')).join(' ')
}

let tokenCalibration = 1

function rawEstimateTokens(text: string): number {
  let tokens = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x4e00 && code <= 0x9fff) {
      tokens += 2
    } else if (code >= 0x3000 && code <= 0x303f) {
      tokens += 1
    } else {
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}

// 用 API 返回的 prompt_tokens 校准估算，避免中文分词误差导致压缩时机失真
export function estimateTokens(text: string): number {
  return Math.ceil(rawEstimateTokens(text) * tokenCalibration)
}

export function calibratePromptTokens(actualPrompt: number | undefined, rawEstimate: number): void {
  if (!actualPrompt || actualPrompt <= 0 || rawEstimate <= 0) return
  const ratio = actualPrompt / rawEstimate
  if (ratio < 0.3 || ratio > 3) return
  tokenCalibration = ratio
  useLogsStore
    .getState()
    .appendLocal('info', 'llm-worker', `分词校准 ${ratio.toFixed(2)}x（实测 ${actualPrompt} / 估算 ${rawEstimate}）`)
}

export function promptRawTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + rawEstimateTokens(messageText(m)) + 8, 0)
}

export function computeContextUsage(
  systemContent: string,
  memoryBlock: string | undefined,
  history: ChatMessage[],
  maxTokens: number,
  summariesText: string | null,
): ContextUsage {
  const systemTokens = estimateTokens(systemContent)
  const memoryTokens = memoryBlock ? estimateTokens(memoryBlock) : 0
  const historyTokens =
    history.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0) +
    (summariesText ? estimateTokens(summariesText) : 0)
  return {
    systemTokens,
    memoryTokens,
    historyTokens,
    totalTokens: systemTokens + memoryTokens + historyTokens,
    maxTokens,
  }
}
