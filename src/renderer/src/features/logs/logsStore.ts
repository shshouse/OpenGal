import { create } from 'zustand'
import type { LogEntry, LogLevel } from '@shared/log'

const MAX_ENTRIES = 2000

interface LogsState {
  entries: LogEntry[]
  append: (entry: LogEntry) => void
  appendLocal: (level: LogLevel, source: string, message: string, details?: string) => void
  hydrate: () => Promise<void>
  clear: () => void
}

function localId(): string {
  return `r-${crypto.randomUUID()}`
}

function trim(list: LogEntry[]): LogEntry[] {
  if (list.length <= MAX_ENTRIES) return list
  return list.slice(list.length - MAX_ENTRIES)
}

export const useLogsStore = create<LogsState>((set) => ({
  entries: [],
  append: (entry) => set((s) => ({ entries: trim([...s.entries, entry]) })),
  appendLocal: (level, source, message, details) =>
    set((s) => ({
      entries: trim([
        ...s.entries,
        { id: localId(), timestamp: Date.now(), level, source, message, details },
      ]),
    })),
  // 主进程缓冲是唯一真源：保留只在渲染进程产生的条目（r- 前缀），其余以主进程为准，
  // 这样主进程清空后不会被旧数据「复活」。
  hydrate: async () => {
    const res = await window.opengal.logs.list()
    const remote = res.success && Array.isArray(res.data) ? res.data : []
    set((s) => {
      const known = new Set(remote.map((e) => e.id))
      const localOnly = s.entries.filter((e) => e.id.startsWith('r-') && !known.has(e.id))
      return { entries: trim([...remote, ...localOnly]) }
    })
  },
  clear: () => set({ entries: [] }),
}))

export function startLogsBridge(): () => void {
  const off = window.opengal.logs.onEntry((entry) => {
    useLogsStore.getState().append(entry)
  })
  void useLogsStore.getState().hydrate()
  return off
}
