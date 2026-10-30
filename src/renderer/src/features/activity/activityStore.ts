import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ActivityKind = 'user' | 'speech' | 'tool' | 'system' | 'error'

export interface ActivityEntry {
  id: string
  characterId: string
  kind: ActivityKind
  title: string
  detail?: string
  at: number
  ok?: boolean
}

interface ActivityState {
  byCharacter: Record<string, ActivityEntry[]>
  add: (entry: ActivityEntry) => void
  clearCharacter: (characterId: string) => void
}

const MAX_PER_CHARACTER = 200
const EMPTY_ACTIVITIES: ActivityEntry[] = []

export function selectActivities(state: { byCharacter: Record<string, ActivityEntry[]> }, characterId: string): ActivityEntry[] {
  return Object.prototype.hasOwnProperty.call(state.byCharacter, characterId) ? state.byCharacter[characterId] : EMPTY_ACTIVITIES
}

export const useActivityStore = create<ActivityState>()(persist((set) => ({
  byCharacter: {},
  add: (entry) => set((state) => {
    const current = selectActivities(state, entry.characterId)
    if (current.some((item) => item.id === entry.id)) return state
    return {
      byCharacter: {
        ...state.byCharacter,
        [entry.characterId]: [...current, entry].slice(-MAX_PER_CHARACTER),
      },
    }
  }),
  clearCharacter: (characterId) => set((state) => {
    const next = { ...state.byCharacter }
    delete next[characterId]
    return { byCharacter: next }
  }),
}), {
  name: 'opengal-activity',
  storage: createJSONStorage(() => ({
    getItem: (key) => { try { return localStorage.getItem(key) } catch { return null } },
    setItem: (key, value) => { try { localStorage.setItem(key, value) } catch { /* 缓存失败不阻断角色活动 */ } },
    removeItem: (key) => { try { localStorage.removeItem(key) } catch { /* 保留内存状态 */ } },
  })),
  partialize: (state) => ({ byCharacter: state.byCharacter }),
}))
