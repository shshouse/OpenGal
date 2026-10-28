import { create } from 'zustand'
import type { CharacterRunningMap } from '@shared/characterRuntime'

interface CharacterRuntimeState {
  byId: CharacterRunningMap
  hydrate: (running: CharacterRunningMap | undefined) => void
  setRunning: (characterId: string, running: boolean) => CharacterRunningMap
}

export const useCharacterRuntimeStore = create<CharacterRuntimeState>((set, get) => ({
  byId: {},
  hydrate: (running) => set({ byId: running ?? {} }),
  setRunning: (characterId, running) => {
    const next = { ...get().byId, [characterId]: running }
    set({ byId: next })
    return next
  },
}))
