import { create } from 'zustand'

export interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  ok: boolean
  result: string
  durationMs: number
}

interface ToolCallsState {
  records: ToolCallRecord[]
  add: (record: ToolCallRecord) => void
  clear: () => void
}

export const useToolCallsStore = create<ToolCallsState>((set) => ({
  records: [],
  add: (record) => set((state) => ({ records: [...state.records, record] })),
  clear: () => set({ records: [] }),
}))
