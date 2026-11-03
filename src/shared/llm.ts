import type { LLMConfig } from './config'
import type { EmotionTag } from './role'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface TextContentPart {
  type: 'text'
  text: string
}

export interface ImageContentPart {
  type: 'image_url'
  image_url: { url: string }
}

export type MessageContentPart = TextContentPart | ImageContentPart
export type MessageContent = string | MessageContentPart[]

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatMessage {
  role: ChatRole
  content: MessageContent
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
  // 持久化辅助字段：由主进程读取时附带，渲染层原样带回用于保序/保时间戳
  dbId?: number
  ts?: number
  // 上下文装配标记：摘要/环境/意图段有不同的保留优先级
  contextTag?: 'summary' | 'env' | 'intent'
}

export interface LLMRequest {
  messages: ChatMessage[]
  overrides?: Partial<LLMConfig>
  // main=表达层（台词）；sub=判断层（导演/记忆等），未配置副手时回退主模型
  slot?: 'main' | 'sub'
  tools?: ToolDefinition[]
  toolChoice?: unknown
}

export interface LLMUsage {
  promptTokens: number
  completionTokens?: number
  totalTokens?: number
}

export interface LLMResponse {
  content: string
  toolCalls?: ToolCall[]
  usage?: LLMUsage
}

export interface LLMDialogueItem {
  text: string
  emotion?: EmotionTag | string
  action?: string
  [key: string]: unknown
}
