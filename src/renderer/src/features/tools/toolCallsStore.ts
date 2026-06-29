/**
 * 工具调用记录 store。
 *
 * 一次完整的 user turn 可能触发多轮 tool_calls（多 tool / 工具循环）。
 * 每条 tool_call 一旦执行完毕就把结果写入本 store，由 ChatPanel 在 assistant
 * 气泡下方渲染 "调用了 N 个工具" 折叠块。
 *
 * 数据生命周期：
 * 1. user:input 触发 runTurn → llmWorker.recordToolCalls() 一次性接收本轮所有调用
 * 2. 工具循环每轮调 recordToolCall() 追加一条 ToolCallRecord
 * 3. finalizeStream 时 chatStore 把最后这批 records 关联到刚写入的 assistant 消息
 *
 * 简化为「上一轮的 records」模式，避免每条消息都带 records 字段污染 ChatMessage 模型。
 */

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
  /** 本轮（最近一次 user turn）累积的工具调用列表 */
  records: ToolCallRecord[]
  add: (record: ToolCallRecord) => void
  clear: () => void
}

/**
 * 工具调用实时 store：仅在"当前轮 LLM 还在跑"时作为写入目标。
 *
 * 注意：本 store 的 records 不会持久化到历史 assistant 消息上——
 * 历史记录的展示依赖 chatStore 落盘到 message.toolCalls。
 *
 * 当前 store 的可见用途：
 * - llmWorker 在 tool 循环中追加 record
 * - useChatPipeline 在 llm:done 时读取快照并传给 finalizeStream
 */
export const useToolCallsStore = create<ToolCallsState>((set) => ({
  records: [],
  add: (record) => set((state) => ({ records: [...state.records, record] })),
  clear: () => set({ records: [] }),
}))
