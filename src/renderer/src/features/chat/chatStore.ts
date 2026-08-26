import { create } from 'zustand'
import type { ChatMessage, LLMDialogueItem, MessageContentPart } from '@shared/types'
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
 *
 * 多模态：带图片时 content 是 OpenAI 兼容的多模态片段数组
 * （[text, image_url, ...]），images 存同样的 data:base64 URL 供 UI 缩略图用。
 */
export interface PersistedUserMessage extends ChatMessage {
  /** 用户的原始问题（不含引用块），用于 UI 气泡显示 */
  userText: string
  /** 附带的图片（data:base64 URL），用于 UI 缩略图与多模态 content 构建 */
  images?: string[]
}

/** 单个角色的会话快照（切走时存档，切回来恢复） */
interface ChatSession {
  messages: (PersistedAssistantMessage | PersistedUserMessage)[]
}

interface ChatState {
  /** 当前会话归属的角色 id；null 表示未选角色 */
  sessionId: string | null
  /** 每个角色一份的会话存档（内存态，随应用生命周期） */
  sessions: Record<string, ChatSession>
  /** 已从磁盘水合过的角色 id（避免重复 load 覆盖在途内容） */
  hydratedIds: Record<string, true>
  /** 当前激活会话的消息视图（= sessions[sessionId] 的内容） */
  messages: (PersistedAssistantMessage | PersistedUserMessage)[]
  isSending: boolean
  error: string | null
  streamingSegments: StreamingSegment[]
  appendUser: (message: string, images?: string[]) => void
  replaceError: (error: string | null) => void
  setSending: (sending: boolean) => void
  appendStreamingSegment: (segment: StreamingSegment) => void
  markSegmentTTSQueued: (index: number) => void
  finalizeStream: (rawContent?: string, toolCalls?: ToolCallRecord[]) => void
  clear: () => void
  /**
   * 切换会话到指定角色：把当前会话存入 sessions[旧id]，载入 sessions[新id]。
   * 调用方需先中止在途流式（旧角色的输出不属于新会话）。
   */
  switchSession: (characterId: string | null) => void
  /**
   * 从磁盘水合指定角色的会话（幂等：已水合则跳过）。
   * 若该角色正是当前激活会话，同时刷新 messages 视图。
   */
  ensureHydrated: (characterId: string) => Promise<void>
}

/** 由纯文本 + 图片构建 user 消息的多模态 content。无图片时退化为纯字符串。 */
function buildUserContent(text: string, images?: string[]): ChatMessage['content'] {
  if (!images || images.length === 0) return text
  const parts: MessageContentPart[] = []
  if (text) parts.push({ type: 'text', text })
  for (const url of images) {
    parts.push({ type: 'image_url', image_url: { url } })
  }
  return parts
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  sessions: {},
  hydratedIds: {},
  messages: [],
  isSending: false,
  error: null,
  streamingSegments: [],
  appendUser: (message, images) => {
    const userMsg: PersistedUserMessage = {
      role: 'user' as const,
      content: buildUserContent(message, images),
      userText: message
    }
    if (images && images.length > 0) userMsg.images = images
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
  clear: () => {
    const { sessionId } = get()
    set({ messages: [], error: null, streamingSegments: [] })
    // 清空同步落盘，避免重启后旧会话复活
    if (sessionId) {
      void window.opengal.chatHistory.clear(sessionId).catch(() => {})
    }
  },
  switchSession: (characterId) => {
    const { sessionId } = get()
    if (sessionId === characterId) return
    set((state) => {
      // 当前会话存档（即使是空的也存，保持"切回来是离开时的样子"）
      const sessions = { ...state.sessions }
      if (state.sessionId) {
        sessions[state.sessionId] = { messages: state.messages }
      }
      const restored = (characterId && sessions[characterId]) || { messages: [] }
      return {
        sessionId: characterId,
        sessions,
        messages: restored.messages,
        // 流式片段/发送中/错误都属于旧角色的在途轮次，不带到新会话
        streamingSegments: [],
        isSending: false,
        error: null
      }
    })
  },
  ensureHydrated: async (characterId) => {
    if (get().hydratedIds[characterId]) return
    // 先标记，避免并发重复拉取
    set((state) => ({ hydratedIds: { ...state.hydratedIds, [characterId]: true } }))
    try {
      const res = await window.opengal.chatHistory.load(characterId)
      const loaded = (res.success && Array.isArray(res.data) ? res.data : []) as (
        | PersistedAssistantMessage
        | PersistedUserMessage
      )[]
      set((state) => {
        const sessions = { ...state.sessions, [characterId]: { messages: loaded } }
        // 只有当前正看着这个会话才刷新视图，否则只进存档
        if (state.sessionId === characterId) {
          return { sessions, messages: loaded }
        }
        return { sessions }
      })
    } catch {
      // 读取失败按空会话处理，不阻断使用
    }
  }
}))

// ---- 会话持久化：监听激活会话的 messages 变化，防抖落盘 ----
// 只在「当前激活会话且有内容变化」时写盘；流式分片走 streamingSegments 不触发。
let persistTimer: ReturnType<typeof setTimeout> | null = null
useChatStore.subscribe((state, prev) => {
  if (state.messages === prev.messages && state.sessionId === prev.sessionId) return
  const { sessionId, messages } = state
  if (!sessionId) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    // 落盘前再取一次最新快照，避免写入防抖期间的旧引用
    const cur = useChatStore.getState()
    if (!cur.sessionId) return
    void window.opengal.chatHistory
      .save(cur.sessionId, cur.messages as ChatMessage[])
      .catch(() => {})
  }, 800)
})
