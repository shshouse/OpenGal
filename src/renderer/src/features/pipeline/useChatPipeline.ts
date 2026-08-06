/**
 * React 钩子：把 chatStore 与流水线拼起来，并替换原来的 `useSendChat`。
 *
 * 职责：
 * - send(text)：写入用户消息到 chatStore，发布 `user:input` 让 LLMWorker 接管
 * - 订阅 `llm:done`：finalizeStream + 推送 pet bubble + 清 sending 标志
 *
 * 对齐 RachelForster：useSendChat 不再持有任何 LLM/TTS 相关逻辑，与 Worker 解耦。
 */

import { useCallback, useEffect } from 'react'
import { useChatStore } from '@/features/chat/chatStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { pipelineBus } from './pipelineBus'
import { getLastRawResponse } from './llmWorker'
import { useToolCallsStore } from '@/features/tools/toolCallsStore'

export function useChatPipeline() {
  const setSending = useChatStore((s) => s.setSending)
  const replaceError = useChatStore((s) => s.replaceError)
  const appendUser = useChatStore((s) => s.appendUser)
  const finalizeStream = useChatStore((s) => s.finalizeStream)

  useEffect(() => {
    const off = pipelineBus.on('llm:done', (msg) => {
      // 拿到本轮 tool 调用快照，在 finalize 之前抓取（之后会被 worker 清空）
      const toolCallsSnapshot = useToolCallsStore.getState().records
      if (!msg.ok) {
        replaceError(msg.error || 'LLM stream failed')
        useLogsStore
          .getState()
          .appendLocal('error', 'chat', `本轮失败: ${msg.error || 'LLM stream failed'}`)
        finalizeStream(undefined, toolCallsSnapshot.length > 0 ? toolCallsSnapshot : undefined)
        setSending(false)
        return
      }
      // segments 已包含 parser 解析后的清洗文本；如果完全没有 segments，
      // 说明 LLM 没按 JSON 协议输出，把实际返回内容暴露给用户，便于定位
      // 是模型选错 / system prompt 没生效 / 返回为空。
      const segCount = useChatStore.getState().streamingSegments.length
      const raw = getLastRawResponse()
      if (segCount === 0) {
        const t = raw.trim()
        if (!t) {
          replaceError('LLM 返回为空。可能原因：模型名错误、API Key 无效、provider 不支持。请检查 LLM 设置。')
        } else {
          const preview = t.length > 400 ? t.slice(0, 400) + ' ...(截断)' : t
          replaceError(
            `LLM 未按 JSON 协议输出。实际返回：\n${preview}\n\n请检查模型是否支持 JSON 指令跟随。`,
          )
        }
      }
      // pet bubble 要给用户看的纯文本，从 segments 拿（finalize 前），不能用 raw JSON。
      const visibleText = useChatStore
        .getState()
        .streamingSegments.map((s) => s.item.text)
        .join('')
      // 落盘到对话历史时优先用 raw（合规 JSON），保证下一轮 messages 历史的 assistant content
      // 与 system prompt 约定一致，避免 DeepSeek JSON Mode 因"违约历史"抽风。
      finalizeStream(
        raw,
        toolCallsSnapshot.length > 0 ? toolCallsSnapshot : undefined,
      )
      if (visibleText) {
        window.opengal.pet.sendBubble(visibleText).catch(() => {})
      }
      setSending(false)
    })
    return off
  }, [appendUser, finalizeStream, replaceError, setSending])

  return useCallback(
    function send(userContent: string): void {
      const trimmed = userContent.trim()
      if (!trimmed) return
      replaceError(null)
      appendUser(trimmed)
      setSending(true)
      useLogsStore
        .getState()
        .appendLocal(
          'info',
          'chat',
          `用户输入: ${trimmed.slice(0, 200)}`
        )
      pipelineBus.emit('user:input', { text: trimmed, source: 'user' })
    },
    [appendUser, replaceError, setSending],
  )
}
