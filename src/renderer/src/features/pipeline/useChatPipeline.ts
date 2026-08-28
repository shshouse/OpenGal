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
      const visibleText = useChatStore
        .getState()
        .streamingSegments.map((s) => s.item.text)
        .join('')
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
    function send(userContent: string, images?: string[]): void {
      const trimmed = userContent.trim()
      if (!trimmed && (!images || images.length === 0)) return
      replaceError(null)
      appendUser(trimmed, images)
      setSending(true)
      useLogsStore
        .getState()
        .appendLocal(
          'info',
          'chat',
          `用户输入: ${trimmed.slice(0, 200)}${images && images.length > 0 ? ` [图片×${images.length}]` : ''}`
        )
      pipelineBus.emit('user:input', { text: trimmed, source: 'user' })
    },
    [appendUser, replaceError, setSending],
  )
}
