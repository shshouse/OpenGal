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
    if (sessionId) {
      void window.opengal.chatHistory.clear(sessionId).catch(() => {})
    }
  },
  switchSession: (characterId) => {
    const { sessionId } = get()
    if (sessionId === characterId) return
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
      set((state) => {
        const sessions = { ...state.sessions, [characterId]: { messages: loaded } }
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

let persistTimer: ReturnType<typeof setTimeout> | null = null
useChatStore.subscribe((state, prev) => {
  if (state.messages === prev.messages && state.sessionId === prev.sessionId) return
  const { sessionId, messages } = state
  if (!sessionId) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    const cur = useChatStore.getState()
    if (!cur.sessionId) return
    void window.opengal.chatHistory
      .save(cur.sessionId, cur.messages as ChatMessage[])
      .catch(() => {})
  }, 800)
})
