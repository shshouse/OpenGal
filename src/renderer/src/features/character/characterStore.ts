import { create } from 'zustand'
import type { RoleCardEntry } from '@shared/types'
import { setActiveRoleCard as wireLLMWorkerRoleCard, pipelineBus } from '@/features/pipeline'
import { useChatStore } from '@/features/chat/chatStore'
import { getLive2DModel } from '@/features/live2d/live2dBus'

interface CharacterState {
  list: RoleCardEntry[]
  activeId: string | null
  loading: boolean
  error: string | null
  loadCharacters: (preferredActiveId?: string | null) => Promise<void>
  setActive: (id: string) => Promise<void>
  getActive: () => RoleCardEntry | null
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  list: [],
  activeId: null,
  loading: false,
  error: null,

  loadCharacters: async (preferredActiveId) => {
    set({ loading: true, error: null })
    const res = await window.opengal.character.list()
    if (!res.success || !res.data) {
      set({ loading: false, error: res.error || '加载角色列表失败' })
      return
    }
    const list = res.data
    const current = get().activeId
    const desiredId = preferredActiveId ?? current
    const active =
      list.find((c) => c.id === desiredId) ??
      list[0] ??
      null
    set({ list, activeId: active?.id ?? null, loading: false })
    if (active) {
      useChatStore.getState().switchSession(active.id)
      wireLLMWorkerRoleCard(active)
      void useChatStore.getState().ensureHydrated(active.id)
    }
  },

  setActive: async (id) => {
    const card = get().list.find((c) => c.id === id)
    if (!card) {
      set({ error: `未找到角色卡: ${id}` })
      return
    }
    if (id === get().activeId) return
    const chat = useChatStore.getState()
    if (chat.isSending || chat.streamingSegments.length > 0) {
      pipelineBus.emit('pipeline:abort', undefined)
      try { getLive2DModel()?.stopSpeaking() } catch { /* ignore */ }
    }
    chat.switchSession(id)
    set({ activeId: id, error: null })
    wireLLMWorkerRoleCard(card)
    void useChatStore.getState().ensureHydrated(id)
    await window.opengal.config.set({ activeCharacterId: id })
    void window.opengal.tts.reset()
  },

  getActive: () => {
    const id = get().activeId
    if (!id) return null
    return get().list.find((c) => c.id === id) ?? null
  },
}))
