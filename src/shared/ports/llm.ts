import type { LLMRequest, LLMResponse, LLMUsage, ToolCall } from '../types'

export interface LlmCapabilities {
  streaming: boolean
  tools: boolean
  vision: boolean
  maxContext?: number
}

export type LlmStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: LLMUsage }
  | { type: 'done' }

/** 模型端口：沿用现有请求/响应类型，上层不感知协议差异。 */
export interface LlmProvider {
  readonly id: string
  capabilities(model: string): LlmCapabilities
  chat(req: LLMRequest, signal?: AbortSignal): Promise<LLMResponse>
  stream(req: LLMRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent>
}
