import { create } from 'zustand'
import type { ChatMessage, LLMDialogueItem } from '@shared/types'
import type { ToolCallRecord } from '@/features/tools/toolCallsStore'

/** 知识库文件附件：文件名 + 原始内容（保留空行用于分行） */
export interface RagAttachment {
  fileName: string
  content: string
}

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
  /** 引用的本地文件（LLM 看到的完整 content 包含引用块） */
  attachments?: RagAttachment[]
}

interface ChatState {
  messages: (PersistedAssistantMessage | PersistedUserMessage)[]
  isSending: boolean
  error: string | null
  streamingSegments: StreamingSegment[]
  appendUser: (message: string, attachments?: RagAttachment[]) => void
  replaceError: (error: string | null) => void
  setSending: (sending: boolean) => void
  appendStreamingSegment: (segment: StreamingSegment) => void
  markSegmentTTSQueued: (index: number) => void
  finalizeStream: (rawContent?: string, toolCalls?: ToolCallRecord[]) => void
  clear: () => void
}

/**
 * 把用户问题 + 附件渲染成 LLM 能直接读的结构化 user 消息。
 * - 引用块用「【引用：...】...【引用结束】」包裹，与用户问题空行分隔
 * - 每个文件每行前缀「行N:」，空行保留「行N:」保证行号连续
 * - 最后一行明确指令「请只基于以上引用回答，不确定的内容说『引用中没有相关信息』」
 */
export function formatUserMessage(
  userText: string,
  attachments: RagAttachment[] | undefined
): string {
  if (!attachments || attachments.length === 0) return userText

  const blocks: string[] = []
  for (const att of attachments) {
    const lines = att.content.split('\n')
    const total = lines.length
    const numbered = lines
      .map((line, i) => `行${i + 1}: ${line}`)
      .join('\n')
    const size = new Blob([att.content]).size
    blocks.push(
      `【引用：${att.fileName} · 共 ${total} 行 · ${size}B】\n${numbered}\n【引用结束】`
    )
  }

  return (
    blocks.join('\n\n') +
    `\n\n用户的问题：\n${userText}\n\n【指令：请严格基于上面的引用内容回答；引用中第 N 行以"行N:"开头。如问"第几行写的什么"，请精确回复该行原始内容；如问的内容引用里没有，请说"引用中没有相关信息"。】`
  )
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isSending: false,
  error: null,
  streamingSegments: [],
  appendUser: (message, attachments) => {
    const content = formatUserMessage(message, attachments)
    const userMsg: PersistedUserMessage = {
      role: 'user' as const,
      content,
      userText: message
    }
    if (attachments && attachments.length > 0) userMsg.attachments = attachments
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

