/**
 * LLM 适配器抽象。对齐 RachelForster 的 `sdk/adapters/llm.LLMAdapter`：
 * - 每个供应商一个实现
 * - chat() 完成一次同步请求
 * - chatStream() 把流式增量通过回调推给上层
 *
 * 为什么不用 OpenAI SDK：
 * - 我们的供应商列表包含 Anthropic（协议不兼容）
 * - SDK 引入体积大且与 fetch 实现冗余
 * - 现有 llmClient.ts 直接 fetch + SSE 解析已经稳定
 */

import type { ChatMessage, LLMConfig, LLMResponse, ToolCall, ToolDefinition } from '@shared/types'

export interface LLMStreamCallbacks {
  /** 正文增量（不含 reasoning） */
  onContent: (delta: string) => void
  /** 思维链 / reasoning 增量 */
  onReasoning?: (delta: string) => void
  /** 非致命警告（如 max_tokens 截断），由上层决定如何呈现 */
  onWarning?: (msg: string) => void
  /** 工具调用（流式攒齐后一次性回调） */
  onToolCalls?: (calls: ToolCall[]) => void
}

export interface LLMChatRequest {
  /** OpenAI 格式的消息历史；适配器内部按需重新组装为目标供应商协议 */
  messages: ChatMessage[]
  config: LLMConfig
  signal?: AbortSignal
  tools?: ToolDefinition[]
  toolChoice?: unknown
}

export interface LLMAdapter {
  /** 一次性请求，等待完整结果 */
  chat(req: LLMChatRequest): Promise<LLMResponse>
  /** 流式请求，增量通过回调推给上层 */
  chatStream(req: LLMChatRequest, callbacks: LLMStreamCallbacks): Promise<void>
}
