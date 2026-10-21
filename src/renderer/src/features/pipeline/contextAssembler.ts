import type { ChatMessage } from '@shared/types'

export interface ContextItem {
  id: string
  message: ChatMessage
  priority: number
}

export interface ContextPackResult {
  messages: ChatMessage[]
  keptIds: string[]
  droppedIds: string[]
  totalTokens: number
  overflow: boolean
}

// 必需段：system 与用户意图。即使本身超预算也不丢，只标记 overflow。
const REQUIRED_PRIORITY = 900

// 上下文装箱：高优先级先占预算，输出保持调用方给的原始顺序。
// 典型优先级：system 1000 / intent 950 / env 800 / summary 700 / 历史 100+新近度。
export function packContext(
  items: ContextItem[],
  budget: number,
  estimate: (message: ChatMessage) => number,
): ContextPackResult {
  const sorted = [...items].sort((a, b) => b.priority - a.priority)
  const kept = new Set<string>()
  let total = 0
  let overflow = false

  for (const item of sorted) {
    const tokens = Math.max(0, estimate(item.message))
    const required = item.priority >= REQUIRED_PRIORITY
    if (required || total + tokens <= budget) {
      kept.add(item.id)
      total += tokens
      if (total > budget) overflow = true
    }
  }

  const keptItems = items.filter((item) => kept.has(item.id))
  const droppedItems = items.filter((item) => !kept.has(item.id))
  return {
    messages: keptItems.map((item) => item.message),
    keptIds: keptItems.map((item) => item.id),
    droppedIds: droppedItems.map((item) => item.id),
    totalTokens: total,
    overflow,
  }
}
