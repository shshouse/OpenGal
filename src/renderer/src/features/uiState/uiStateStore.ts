import { create } from 'zustand'
import { mergeUIState, type UIState, type UIStatePatch } from '@shared/uiState'

interface UIStateStore {
  state: UIState
  loaded: boolean
  load: () => Promise<void>
  patch: (patch: UIStatePatch) => void
}

export const useUIStateStore = create<UIStateStore>((set, get) => ({
  state: {},
  loaded: false,
  load: async () => {
    try {
      const result = await window.opengal.uiState.get()
      if (result?.success && result.data) set({ state: result.data, loaded: true })
      else set({ loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  patch: (patch) => {
    set({ state: mergeUIState(get().state, patch) })
    try {
      void window.opengal.uiState.set(patch).catch(() => {
        // 偏好保存失败不阻断当前界面
      })
    } catch {
      // 旧版 preload 没有 uiState 时保持内存态
    }
  },
}))
