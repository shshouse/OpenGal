import { create } from 'zustand'
import type { LogEntry, LogLevel } from '@shared/log'

const MAX_ENTRIES = 2000

interface LogsState {
  entries: LogEntry[]
  panelOpen: boolean
  hydrated: boolean
  append: (entry: LogEntry) => void
  appendLocal: (level: LogLevel, source: string, message: string, details?: string) => void
  setEntries: (list: LogEntry[]) => void
  clear: () => void
  setHydrated: (v: boolean) => void
  setPanelOpen: (v: boolean) => void
}

let seq = 0
function localId(): string {
  seq += 1
  return `r-${Date.now().toString(36)}-${seq.toString(36)}`
}

function trim(list: LogEntry[]): LogEntry[] {
  if (list.length <= MAX_ENTRIES) return list
  return list.slice(list.length - MAX_ENTRIES)
}

export const useLogsStore = create<LogsState>((set) => ({
  entries: [],
  panelOpen: false,
  hydrated: false,
  append: (entry) =>
    set((s) => ({ entries: trim([...s.entries, entry]) })),
  appendLocal: (level, source, message, details) =>
    set((s) => ({
      entries: trim([
        ...s.entries,
        { id: localId(), timestamp: Date.now(), level, source, message, details },
      ]),
    })),
  setEntries: (list) => set({ entries: trim(list.slice()) }),
  clear: () => set({ entries: [] }),
  setHydrated: (v) => set({ hydrated: v }),
  setPanelOpen: (v) => set({ panelOpen: v }),
}))

export function startLogsBridge(): () => void {
  const off = window.opengal.logs.onEntry((entry) => {
    useLogsStore.getState().append(entry)
  })
  void window.opengal.logs.list().then((res) => {
    const store = useLogsStore.getState()
    if (res.success && Array.isArray(res.data)) {
      const seen = new Set(store.entries.map((e) => e.id))
      const merged = res.data.slice()
      for (const e of store.entries) if (!seen.has(e.id)) merged.push(e)
      store.setEntries(merged)
    }
    store.setHydrated(true)
  })
  return off
}
