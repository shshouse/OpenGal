/**
 * 角色卡状态：列表 / 当前激活 / 加载状态。
 *
 * 责任划分：
 * - 启动时 `loadCharacters` 拉一次主进程列表并按 config.activeCharacterId 选中
 * - 用户切角色时 `setActive` 写回 config 并通知 LLMWorker 更新 system prompt
 * - 主进程是唯一真源：增删改靠重新 listCharacters
 */

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
    // 选定 active：preferred -> 已选 -> 第一张
    const current = get().activeId
    const desiredId = preferredActiveId ?? current
    const active =
      list.find((c) => c.id === desiredId) ??
      list[0] ??
      null
    set({ list, activeId: active?.id ?? null, loading: false })
    if (active) {
      // 初次选定也要切换会话归属（从 null 会话切到角色会话）
      useChatStore.getState().switchSession(active.id)
      wireLLMWorkerRoleCard(active)
      // 重启后从磁盘恢复该角色的历史会话
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
    // 在途的输出属于旧角色：先中止流式与播报，再切会话，避免旧内容落进新会话
    const chat = useChatStore.getState()
    if (chat.isSending || chat.streamingSegments.length > 0) {
      pipelineBus.emit('pipeline:abort', undefined)
      try { getLive2DModel()?.stopSpeaking() } catch { /* ignore */ }
    }
    chat.switchSession(id)
    set({ activeId: id, error: null })
    wireLLMWorkerRoleCard(card)
    // 从磁盘恢复该角色历史（幂等，首次切换才真正拉取）
    void useChatStore.getState().ensureHydrated(id)
    // 持久化到 config（必须先 set 再 reset：activeCharacterId 写完后下一次 speak 才会拿到新角色）
    await window.opengal.config.set({ activeCharacterId: id })
    // 清掉主进程 TTS 适配器缓存的 weights：角色切换通常意味着模型也要切
    void window.opengal.tts.reset()
  },

  getActive: () => {
    const id = get().activeId
    if (!id) return null
    return get().list.find((c) => c.id === id) ?? null
  },
}))
