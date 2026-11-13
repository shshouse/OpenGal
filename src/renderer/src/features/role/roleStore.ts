import { create } from 'zustand'
import type { RoleCardEntry } from '@shared/types'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { setActiveRoleCard as wireLLMWorkerRoleCard } from '@/features/pipeline/activeCard'
import { useChatStore } from '@/features/chat/chatStore'
import { getLive2DModel } from '@/features/live2d/live2dBus'

interface RoleState {
  list: RoleCardEntry[]
  activeId: string | null
  loading: boolean
  error: string | null
  outfits: Record<string, string>
  loadRoles: (preferredActiveId?: string | null) => Promise<void>
  setActive: (id: string) => Promise<void>
  setOutfit: (roleId: string, outfitId: string) => void
  getActive: () => RoleCardEntry | null
}

const OUTFIT_STORAGE_KEY = 'opengal:outfits'

function readOutfits(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OUTFIT_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function interruptBusyTurn(): void {
  const chat = useChatStore.getState()
  if (!chat.isSending && chat.streamingSegments.length === 0) return
  pipelineBus.emit('pipeline:abort', undefined)
  try {
    getLive2DModel()?.stopSpeaking()
  } catch {
    // 播放器可能已销毁，切角色不该被它挡住
  }
}

function applyActiveRole(card: RoleCardEntry, set: (partial: Partial<RoleState>) => void): void {
  useChatStore.getState().switchSession(card.id)
  set({ activeId: card.id, error: null })
  wireLLMWorkerRoleCard(card)
  void useChatStore.getState().ensureHydrated(card.id)
}

export const useRoleStore = create<RoleState>((set, get) => ({
  list: [],
  activeId: null,
  loading: false,
  error: null,

  outfits: readOutfits(),

  setOutfit: (roleId, outfitId) => {
    const next = { ...get().outfits, [roleId]: outfitId }
    try {
      localStorage.setItem(OUTFIT_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 存储不可用时仍然切当前会话的显示
    }
    set({ outfits: next })
  },

  loadRoles: async (preferredActiveId) => {
    set({ loading: true, error: null })
    const res = await window.opengal.role.list()
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
    interruptBusyTurn()
    applyActiveRole(card, set)
    await window.opengal.config.set({ activeRoleId: id })
    void window.opengal.tts.reset()
    void window.opengal.boot.recheckTts()
  },

  getActive: () => {
    const id = get().activeId
    if (!id) return null
    return get().list.find((c) => c.id === id) ?? null
  },
}))
