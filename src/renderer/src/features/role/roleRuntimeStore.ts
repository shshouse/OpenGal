import { create } from 'zustand'
import type { RoleRunningMap } from '@shared/role/runtime'
import type { RuntimePoolSnapshot } from '@shared/app/runtime'

interface RoleRuntimeState {
  byId: RoleRunningMap
  hydrate: (running: RoleRunningMap | undefined) => void
  hydrateSnapshot: (snapshot: RuntimePoolSnapshot) => void
  setRunning: (roleId: string, running: boolean) => RoleRunningMap
}

export const useRoleRuntimeStore = create<RoleRuntimeState>((set, get) => ({
  byId: {},
  hydrate: (running) => set({ byId: running ?? {} }),
  hydrateSnapshot: (snapshot) => {
    const running: RoleRunningMap = {}
    for (const [id, item] of Object.entries(snapshot.roles)) running[id] = item.running
    set({ byId: running })
  },
  setRunning: (roleId, running) => {
    const next = { ...get().byId, [roleId]: running }
    set({ byId: next })
    return next
  },
}))
