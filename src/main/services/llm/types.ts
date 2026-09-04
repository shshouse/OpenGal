import type { ChatMessage, LLMConfig, LLMResponse, ToolCall, ToolDefinition } from '@shared/types'

export interface LLMStreamCallbacks {
  onContent: (delta: string) => void
  onReasoning?: (delta: string) => void
  onWarning?: (msg: string) => void
  onToolCalls?: (calls: ToolCall[]) => void
}

export interface LLMChatRequest {
  messages: ChatMessage[]
  config: LLMConfig
  signal?: AbortSignal
  tools?: ToolDefinition[]
  toolChoice?: unknown
}

export interface LLMAdapter {
  chat(req: LLMChatRequest): Promise<LLMResponse>
  chatStream(req: LLMChatRequest, callbacks: LLMStreamCallbacks): Promise<void>
}
