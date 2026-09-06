import { create } from 'zustand'
import type { ChatMessage, LLMDialogueItem, MessageContentPart } from '@shared/types'
import type { ToolCallRecord } from '@/features/tools/toolCallsStore'

export interface StreamingSegment {
  item: LLMDialogueItem
  ttsQueued: boolean
}

export interface PersistedAssistantMessage extends ChatMessage {
  toolCalls?: ToolCallRecord[]
}

export interface PersistedUserMessage extends ChatMessage {
  userText: string
  images?: string[]
}

interface ChatSession {
  messages: (PersistedAssistantMessage | PersistedUserMessage)[]
}

interface ChatState {
  sessionId: string | null
  sessions: Record<string, ChatSession>
  hydratedIds: Record<string, true>
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
  archiveFront: (count: number) => Promise<void>
  clear: () => void
  switchSession: (characterId: string | null) => void
  ensureHydrated: (characterId: string) => Promise<void>
}

function buildUserContent(text: string, images?: string[]): ChatMessage['content'] {
  if (!images || images.length === 0) return text
  const parts: MessageContentPart[] = []
  if (text) parts.push({ type: 'text', text })
  for (const url of images) {
    parts.push({ type: 'image_url', image_url: { url } })
  }
  return parts
}

// 库侧已由动作自行同步（hydrate/归档/切角色），跳过订阅器的一轮持久化
let suppressPersist = 0

function isAppendOf(prev: unknown[], cur: unknown[]): boolean {
  if (prev.length > cur.length) return false
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== cur[i]) return false
  }
  return true
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
  // 存档式压缩：库侧按 id 锚点标记 archived（原文保留），本地移除前缀，摘要由 llmWorker 持久化
  archiveFront: async (count) => {
    const { sessionId, messages } = get()
    if (!sessionId || count <= 0 || count > messages.length) return
    const slice = messages.slice(0, count)
    const fromId = (slice[0] as ChatMessage & { dbId?: number }).dbId
    const toId = (slice[slice.length - 1] as ChatMessage & { dbId?: number }).dbId
    if (typeof fromId === 'number' && typeof toId === 'number') {
      await window.opengal.chatHistory.archiveRange(sessionId, fromId, toId).catch(() => {})
    }
    suppressPersist++
    set((state) => ({ messages: state.messages.slice(count) }))
  },
  clear: () => {
    set({ messages: [], error: null, streamingSegments: [] })
  },
  switchSession: (characterId) => {
    const { sessionId } = get()
    if (sessionId === characterId) return
    suppressPersist++
    set((state) => {
      const sessions = { ...state.sessions }
      if (state.sessionId) {
        sessions[state.sessionId] = { messages: state.messages }
      }
      const restored = (characterId && sessions[characterId]) || { messages: [] }
      return {
        sessionId: characterId,
        sessions,
        messages: restored.messages,
        streamingSegments: [],
        isSending: false,
        error: null
      }
    })
  },
  ensureHydrated: async (characterId) => {
    if (get().hydratedIds[characterId]) return
    set((state) => ({ hydratedIds: { ...state.hydratedIds, [characterId]: true } }))
    try {
      const res = await window.opengal.chatHistory.load(characterId)
      const loaded = (res.success && Array.isArray(res.data) ? res.data : []) as (
        | PersistedAssistantMessage
        | PersistedUserMessage
      )[]
      suppressPersist++
      set((state) => {
        const sessions = { ...state.sessions, [characterId]: { messages: loaded } }
        if (state.sessionId === characterId) {
          return { sessions, messages: loaded }
        }
        return { sessions }
      })
    } catch {
    }
  }
}))

// 增量持久化到 SQLite：纯追加走 append，其余（清空/异常编辑）走 replaceAll
useChatStore.subscribe((state, prev) => {
  if (state.messages === prev.messages && state.sessionId === prev.sessionId) return
  if (state.sessionId !== prev.sessionId) return
  if (suppressPersist > 0) {
    suppressPersist--
    return
  }
  const { sessionId, messages } = state
  if (!sessionId) return
  if (isAppendOf(prev.messages, messages)) {
    const added = messages.slice(prev.messages.length)
    if (added.length > 0) {
      void window.opengal.chatHistory.append(sessionId, added as ChatMessage[]).catch(() => {})
    }
  } else {
    void window.opengal.chatHistory.replaceAll(sessionId, messages as ChatMessage[]).catch(() => {})
  }
})
