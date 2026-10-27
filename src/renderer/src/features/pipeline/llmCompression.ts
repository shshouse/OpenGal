import type { ChatMessage } from '@shared/types'
import { useChatStore } from '@/features/chat/chatStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { estimateTokens, messageText } from './llmContext'

const COMPRESSION_THRESHOLD = 0.85
const TARGET_RATIO = 0.6
const PROTECT_HEAD_MESSAGES = 6
const MAX_SUMMARY_FAILURES = 3
let summaryFailures = 0
let cachedSummariesText: string | null = null

async function loadSummariesText(characterId: string): Promise<string | null> {
  const res = await window.opengal.chatHistory.summaries(characterId)
  const rows = res.success && res.data ? res.data : []
  if (rows.length === 0) {
    cachedSummariesText = null
    return null
  }
  cachedSummariesText = rows.map((r) => r.text).join('\n')
  return cachedSummariesText
}

export function getCachedSummariesText(): string | null {
  return cachedSummariesText
}

// 存档式压缩：超阈值时把旧段摘要追加进 L1（SQLite summaries 分段），原文标记 archived 永不删除
// 头部若干条始终保留，避免把开场设定摘要掉
export async function compressHistory(
  characterId: string,
  history: ChatMessage[],
  turnBudget: number,
  systemTokens: number,
  stale: () => boolean,
): Promise<ChatMessage[]> {
  const summariesText = await loadSummariesText(characterId)
  if (stale()) return history
  const summaryMessage: ChatMessage | null = summariesText
    ? { role: 'system', content: `[既往对话摘要]\n${summariesText}`, contextTag: 'summary' }
    : null

  const headCount = Math.min(PROTECT_HEAD_MESSAGES, history.length)
  const head = history.slice(0, headCount)
  const withSummary = (rest: ChatMessage[]): ChatMessage[] =>
    summaryMessage ? [...head, summaryMessage, ...rest] : [...head, ...rest]
  const unchanged = (): ChatMessage[] =>
    summaryMessage ? withSummary(history.slice(headCount)) : history

  const summaryTokens = summariesText ? estimateTokens(summariesText) : 0
  const historyTokens = history.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0)
  const budget = turnBudget * COMPRESSION_THRESHOLD - systemTokens - summaryTokens
  if (historyTokens <= budget) return unchanged()

  // 尾部预算 = 窗口 × 触发阈值 × 目标比例；1M 窗口约保留 100k 原文
  const tailBudget = Math.max(4000, Math.floor(turnBudget * COMPRESSION_THRESHOLD * TARGET_RATIO))
  let tailTokens = 0
  let keepFrom = history.length
  while (keepFrom > headCount && tailTokens < tailBudget) {
    keepFrom--
    tailTokens += estimateTokens(messageText(history[keepFrom]))
  }
  const toCompress = history.slice(headCount, keepFrom)
  const recent = history.slice(keepFrom)
  if (toCompress.length === 0) return unchanged()

  const summarySource = [
    summariesText ? `【此前摘要】\n${summariesText}` : '',
    '【新增对话】',
    ...toCompress.map((m) => `${m.role === 'user' ? '用户' : '角色'}: ${messageText(m).slice(0, 200)}`),
  ]
    .filter(Boolean)
    .join('\n')

  const res = await window.opengal.llm.chat({
    messages: [
      {
        role: 'system',
        content: '将以下对话历史压缩为一段简洁的摘要，保留关键事实和情感脉络。输出纯文本，不要 JSON。',
      },
      { role: 'user', content: summarySource },
    ],
  })

  if (stale()) return history
  if (!res.success || !res.data?.content) {
    summaryFailures++
    useLogsStore
      .getState()
      .appendLocal('warn', 'llm-worker', `历史压缩失败（连续 ${summaryFailures} 次），跳过本轮`)
    if (summaryFailures >= MAX_SUMMARY_FAILURES) {
      useLogsStore
        .getState()
        .appendLocal('warn', 'llm-worker', `摘要连续失败，强制丢弃 ${toCompress.length} 条最旧原文以控制上下文`)
      return withSummary(recent)
    }
    return unchanged()
  }
  summaryFailures = 0

  const newText = res.data.content.trim()
  // 兜底：压缩后仍超阈值则放弃归档，保原文返回（避免归档与注入脱节）
  const newTotal =
    systemTokens +
    summaryTokens +
    estimateTokens(newText) +
    recent.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0)
  if (newTotal > turnBudget) {
    useLogsStore.getState().appendLocal('warn', 'llm-worker', `压缩后仍超预算 (${newTotal}/${turnBudget})，放弃本轮归档`)
    return unchanged()
  }

  const ids = toCompress.map((m) => (m as ChatMessage & { dbId?: number }).dbId)
  const fromId = ids[0]
  const toId = ids[ids.length - 1]
  if (typeof fromId !== 'number' || typeof toId !== 'number') {
    useLogsStore.getState().appendLocal('warn', 'llm-worker', '待压缩消息缺少数据库 ID，跳过本轮归档')
    return unchanged()
  }
  const committed = await window.opengal.chatHistory.commitCompression(characterId, fromId, toId, {
    start_ts: Date.now(),
    end_ts: Date.now(),
    text: newText,
    message_count: toCompress.length,
  })
  if (!committed?.success || !committed.data || committed.data.archived === 0) {
    useLogsStore.getState().appendLocal('warn', 'llm-worker', '压缩提交失败或区间已归档，取消本轮归档')
    return unchanged()
  }
  if (stale()) return history
  useChatStore.getState().dropFront(toCompress.length, headCount)

  useLogsStore.getState().appendLocal(
    'info',
    'llm-worker',
    `存档压缩: ${toCompress.length} 条归档，新摘要段 ${estimateTokens(newText)} tokens，预算 ${turnBudget}`,
  )

  return withSummary(recent)
}
