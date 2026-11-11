import { create } from 'zustand'
import type { RoleRunningMap } from '@shared/role/runtime'

interface RoleRuntimeState {
  byId: RoleRunningMap
  hydrate: (running: RoleRunningMap | undefined) => void
  setRunning: (roleId: string, running: boolean) => RoleRunningMap
}

export const useRoleRuntimeStore = create<RoleRuntimeState>((set, get) => ({
  byId: {},
  hydrate: (running) => set({ byId: running ?? {} }),
  setRunning: (roleId, running) => {
    const next = { ...get().byId, [roleId]: running }
    set({ byId: next })
    return next
  },
}))
