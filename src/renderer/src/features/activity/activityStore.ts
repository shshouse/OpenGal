import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ActivityKind = 'user' | 'speech' | 'tool' | 'system' | 'error'

export interface ActivityEntry {
  id: string
  roleId: string
  kind: ActivityKind
  title: string
  detail?: string
  at: number
  ok?: boolean
}

interface ActivityState {
  byRole: Record<string, ActivityEntry[]>
  add: (entry: ActivityEntry) => void
  clearRole: (roleId: string) => void
}

const MAX_PER_ROLE = 200
const EMPTY_ACTIVITIES: ActivityEntry[] = []

export function selectActivities(state: { byRole: Record<string, ActivityEntry[]> }, roleId: string): ActivityEntry[] {
  // hasOwnProperty 是安全边界：角色 ID 可能是 "constructor" / "__proto__"，直接索引会沿原型链取到值
  if (!Object.prototype.hasOwnProperty.call(state.byRole, roleId)) return EMPTY_ACTIVITIES
  return state.byRole[roleId] ?? EMPTY_ACTIVITIES
}

export const useActivityStore = create<ActivityState>()(persist((set) => ({
  byRole: {},
  add: (entry) => set((state) => {
    const current = selectActivities(state, entry.roleId)
    if (current.some((item) => item.id === entry.id)) return state
    return {
      byRole: {
        ...state.byRole,
        [entry.roleId]: [...current, entry].slice(-MAX_PER_ROLE),
      },
    }
  }),
  clearRole: (roleId) => set((state) => {
    const next = { ...state.byRole }
    delete next[roleId]
    return { byRole: next }
  }),
}), {
  name: 'opengal-activity',
  storage: createJSONStorage(() => ({
    getItem: (key) => { try { return localStorage.getItem(key) } catch { return null } },
    setItem: (key, value) => { try { localStorage.setItem(key, value) } catch { /* 缓存失败不阻断角色活动 */ } },
    removeItem: (key) => { try { localStorage.removeItem(key) } catch { /* 保留内存状态 */ } },
  })),
  partialize: (state) => ({ byRole: state.byRole }),
}))
