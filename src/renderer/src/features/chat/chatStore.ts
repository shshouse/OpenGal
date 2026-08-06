import { create } from 'zustand'
import type { ChatMessage, LLMDialogueItem } from '@shared/types'
import type { ToolCallRecord } from '@/features/tools/toolCallsStore'

export interface StreamingSegment {
  item: LLMDialogueItem
  ttsQueued: boolean
}

/**
 * 扩展的 assistant 消息：在落盘到 messages 时携带本轮的工具调用快照，
 * 让 UI 在历史消息气泡下也能看到工具调用历史。
 */
export interface PersistedAssistantMessage extends ChatMessage {
  toolCalls?: ToolCallRecord[]
}

/**
 * user 消息携带的文件引用（附件）。内容格式为「引用块 + 用户问题」，
 * LLM 看到的就是这种格式；UI 渲染时会把引用块折叠在用户气泡下。
 */
export interface PersistedUserMessage extends ChatMessage {
  /** 用户的原始问题（不含引用块），用于 UI 气泡显示 */
  userText: string
}

interface ChatState {
  messages: (PersistedAssistantMessage | PersistedUserMessage)[]
  isSending: boolean
  error: string | null
  streamingSegments: StreamingSegment[]
  appendUser: (message: string) => void
  replaceError: (error: string | null) => void
  setSending: (sending: boolean) => void
  appendStreamingSegment: (segment: StreamingSegment) => void
  markSegmentTTSQueued: (index: number) => void
  finalizeStream: (rawContent?: string, toolCalls?: ToolCallRecord[]) => void
  clear: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isSending: false,
  error: null,
  streamingSegments: [],
  appendUser: (message) => {
    const userMsg: PersistedUserMessage = {
      role: 'user' as const,
      content: message,
      userText: message
    }
    set((state) => ({ messages: [...state.messages, userMsg] }))
  },
  replaceError: (error) => set({ error }),
  setSending: (isSending) => set({ isSending }),
  appendStreamingSegment: (segment) =>
    set((state) => ({ streamingSegments: [...state.streamingSegments, segment] })),
  markSegmentTTSQueued: (index) =>
    set((state) => {
      const segments = [...state.streamingSegments]
      if (segments[index]) segments[index] = { ...segments[index], ttsQueued: true }
      return { streamingSegments: segments }
    }),
  finalizeStream: (rawContent, toolCalls) => {
    const { streamingSegments } = get()
    const trimmed = (rawContent ?? '').trim()
    const persistContent =
      trimmed || streamingSegments.map((s) => s.item.text).join('')
    if (persistContent) {
      const persisted: PersistedAssistantMessage = {
        role: 'assistant' as const,
        content: persistContent,
      }
      if (toolCalls && toolCalls.length > 0) {
        persisted.toolCalls = toolCalls
      }
      set((state) => ({
        messages: [...state.messages, persisted],
        streamingSegments: []
      }))
    } else {
      set({ streamingSegments: [] })
    }
  },
  clear: () => set({ messages: [], error: null, streamingSegments: [] })
}))

