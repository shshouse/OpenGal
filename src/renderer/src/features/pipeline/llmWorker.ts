import { DialogueStreamParser, buildSystemPrompt } from '@shared/roleCard'
import type { ChatMessage, LLMDialogueItem, RoleCard, ToolCall, ToolDefinition } from '@shared/types'
import type { LLMDialogMessage, UserInputMessage } from '@shared/messages'
import { useChatStore } from '@/features/chat/chatStore'
import { useToolCallsStore, type ToolCallRecord } from '@/features/tools/toolCallsStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { getAvailableMotionGroups } from '@/features/live2d/live2dBus'
import { pipelineBus } from './pipelineBus'

let counter = 0
let currentStreamId: string | null = null
let bound = false
let unsubscribers: Array<() => void> = []
let activeRoleCard: RoleCard | null = null
let accumulatedReasoning = ''
let accumulatedRaw = ''

export function setActiveRoleCard(card: RoleCard): void {
  activeRoleCard = card
}

export function getLastRawResponse(): string {
  return accumulatedRaw
}

const MAX_TOOL_ROUNDS = 5

export function startLLMWorker(): () => void {
  if (bound) {
    return stopLLMWorker
  }
  bound = true

  const parser = new DialogueStreamParser()

  let dialogCountThisTurn = 0

  const emitDialog = (item: LLMDialogueItem): void => {
    dialogCountThisTurn++
    pipelineBus.emit('llm:dialog', toDialogMessage(item))
  }

  const offUserInput = pipelineBus.on('user:input', (input: UserInputMessage) => {
    if (!activeRoleCard) {
      pipelineBus.emit('llm:done', { ok: false, error: 'No active role card' })
      return
    }
    if (currentStreamId) {
      try {
        void window.opengal.llm.abortStream(currentStreamId)
      } catch {
        /* ignore */
      }
    }
    parser.reset()
    accumulatedReasoning = ''
    accumulatedRaw = ''
    dialogCountThisTurn = 0
    useToolCallsStore.getState().clear()

    currentStreamId = `stream_${++counter}_${Date.now()}`

    void runTurn(input.text).catch((err: Error) => {
      currentStreamId = null
      pipelineBus.emit('llm:done', { ok: false, error: err.message })
    })
  })

  async function runTurn(userText: string): Promise<void> {
    const history = useChatStore.getState().messages

    const motionGroups = getAvailableMotionGroups()
    const systemContent = buildSystemPrompt(activeRoleCard!, motionGroups)

    let messagesForLLM: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...sanitizeHistoryForLLM(history),
    ]

    const toolsResp = await window.opengal.tools.list()
    const tools: ToolDefinition[] = toolsResp.success && toolsResp.data ? toolsResp.data : []

    const firstResult = await runStreamRound(messagesForLLM, tools)
    if (!firstResult.ok) {
      currentStreamId = null
      pipelineBus.emit('llm:done', { ok: false, error: firstResult.error })
      return
    }
    if (!firstResult.toolCalls || firstResult.toolCalls.length === 0) {
      finalizeAndEmit(accumulatedRaw, parser, () => parser.flush().forEach(emitDialog))
      return
    }
    messagesForLLM = messagesForLLM.concat([
      {
        role: 'assistant',
        content: firstResult.assistantContent,
        tool_calls: firstResult.toolCalls,
      },
    ])

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const prevToolCalls = messagesForLLM[messagesForLLM.length - 1].tool_calls ?? []
      const toolMessages: ChatMessage[] = []
      for (const tc of prevToolCalls) {
        const start = performance.now()
        const exec = await window.opengal.tools.execute(tc.function.name, tc.function.arguments)
        const durationMs = Math.round(performance.now() - start)
        let resultContent: string
        let ok = true
        if (exec.success && exec.data) {
          if (exec.data.ok) {
            resultContent = exec.data.result
          } else {
            resultContent = `工具执行失败: ${exec.data.error}`
            ok = false
          }
        } else {
          resultContent = `工具执行失败: ${exec.error}`
          ok = false
        }
        let parsedArgs: Record<string, unknown> = {}
        try {
          parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>
        } catch {
          parsedArgs = { _raw: tc.function.arguments }
        }
        const record: ToolCallRecord = {
          id: tc.id,
          name: tc.function.name,
          args: parsedArgs,
          ok,
          result: resultContent,
          durationMs,
        }
        useToolCallsStore.getState().add(record)
        pipelineBus.emit('llm:reasoning', {
          delta: `[tool:${tc.function.name}] ${resultContent.slice(0, 200)}${resultContent.length > 200 ? '…' : ''}\n`,
          accumulated: '',
        })
        toolMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: resultContent,
        })
      }
      messagesForLLM = messagesForLLM.concat(toolMessages)

      const nonStream = await window.opengal.llm.chat({
        messages: messagesForLLM,
        overrides: activeRoleCard!.llm,
        tools,
        toolChoice: 'auto',
      })
      if (!nonStream.success) {
        currentStreamId = null
        pipelineBus.emit('llm:done', { ok: false, error: nonStream.error || 'Tool 续传失败' })
        return
      }
      const data = nonStream.data!
      const assistantContent = data.content || ''
      const toolCalls = data.toolCalls
      if (data.usage) pipelineBus.emit('llm:usage', data.usage)

      const tmpParser = new DialogueStreamParser()
      for (const it of tmpParser.feed(assistantContent)) emitDialog(it)
      for (const it of tmpParser.flush()) emitDialog(it)

      if (toolCalls && toolCalls.length > 0) {
        messagesForLLM = messagesForLLM.concat([
          { role: 'assistant', content: assistantContent, tool_calls: toolCalls },
        ])
        continue
      }
      accumulatedRaw = assistantContent
      finalizeAndEmit(assistantContent, parser, () => {})
      return
    }

    currentStreamId = null
    pipelineBus.emit('llm:done', { ok: false, error: `工具循环超过 ${MAX_TOOL_ROUNDS} 轮，已强制终止` })
  }

  function finalizeAndEmit(
    rawContent: string,
    p: DialogueStreamParser,
    flush: () => void,
  ): void {
    flush()
    if (dialogCountThisTurn === 0) {
      const raw = (rawContent || accumulatedRaw).trim()
      const reasoning = accumulatedReasoning.trim()
      if (raw) {
        useLogsStore
          .getState()
          .appendLocal(
            'warn',
            'llm-worker',
            'LLM 未按 JSON 协议输出，已用 fallback 包装为单条 text',
            raw.slice(0, 2000),
          )
        emitDialog({ text: raw })
      } else if (reasoning) {
        useLogsStore
          .getState()
          .appendLocal(
            'warn',
            'llm-worker',
            'LLM content 通道为空，用 reasoning 通道兜底（建议关闭思考模式或调高 max_tokens）',
            reasoning.slice(0, 2000),
          )
        emitDialog({ text: reasoning })
      } else {
        useLogsStore
          .getState()
          .appendLocal('error', 'llm-worker', 'LLM 本轮返回空')
      }
    } else {
      useLogsStore
        .getState()
        .appendLocal('info', 'llm-worker', `本轮解析出 ${dialogCountThisTurn} 条 dialog`)
    }
    currentStreamId = null
    pipelineBus.emit('llm:done', { ok: true })
  }

  const offChunk = window.opengal.llm.onStreamChunk((id, chunk) => {
    if (id !== currentStreamId) return
    accumulatedRaw += chunk
    const items = parser.feed(chunk)
    for (const item of items) emitDialog(item)
  })

  const offReasoning = window.opengal.llm.onStreamReasoning((id, delta) => {
    if (id !== currentStreamId) return
    accumulatedReasoning += delta
    pipelineBus.emit('llm:reasoning', { delta, accumulated: accumulatedReasoning })
  })

  const offDone = window.opengal.llm.onStreamDone((id) => {
    if (id !== currentStreamId) return
  })

  const offError = window.opengal.llm.onStreamError((id, error) => {
    if (id !== currentStreamId) return
    useLogsStore.getState().appendLocal('error', 'llm-worker', `LLM 流错误: ${error}`)
    currentStreamId = null
    pipelineBus.emit('llm:done', { ok: false, error })
  })

  const offAbort = pipelineBus.on('pipeline:abort', () => {
    const wasStreaming = currentStreamId !== null
    if (currentStreamId) {
      try {
        void window.opengal.llm.abortStream(currentStreamId)
      } catch {
        /* ignore */
      }
      currentStreamId = null
    }
    parser.reset()
    if (wasStreaming) {
      pipelineBus.emit('llm:done', { ok: true })
    }
  })

  const offUsage = window.opengal.llm.onStreamUsage((id, usage) => {
    if (id !== currentStreamId) return
    pipelineBus.emit('llm:usage', usage)
  })

  unsubscribers = [offUserInput, offChunk, offReasoning, offDone, offError, offAbort, offUsage]
  return stopLLMWorker
}

async function runStreamRound(
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<
  | { ok: true; assistantContent: string; toolCalls: ToolCall[] | undefined }
  | { ok: false; error: string }
> {
  return new Promise((resolve) => {
    let assistantContent = ''
    let capturedToolCalls: ToolCall[] | undefined
    const localUnsubs: Array<() => void> = []

    const startId = currentStreamId

    const onChunk = (streamId: string, chunk: string): void => {
      if (streamId !== startId) return
      assistantContent += chunk
    }
    const offChunk = window.opengal.llm.onStreamChunk(onChunk)
    localUnsubs.push(offChunk)

    const onToolCalls = (streamId: string, calls: ToolCall[]): void => {
      if (streamId !== startId) return
      capturedToolCalls = calls
    }
    const offToolCalls = window.opengal.llm.onToolCalls(onToolCalls)
    localUnsubs.push(offToolCalls)

    const onDone = (streamId: string): void => {
      if (streamId !== startId) return
      cleanup()
      resolve({ ok: true, assistantContent, toolCalls: capturedToolCalls })
    }
    const offDone = window.opengal.llm.onStreamDone(onDone)
    localUnsubs.push(offDone)

    const onError = (streamId: string, error: string): void => {
      if (streamId !== startId) return
      cleanup()
      resolve({ ok: false, error })
    }
    const offError = window.opengal.llm.onStreamError(onError)
    localUnsubs.push(offError)

    function cleanup(): void {
      for (const off of localUnsubs) off()
    }

    void window.opengal.llm
      .chatStream(
        { messages, overrides: activeRoleCard!.llm, tools, toolChoice: 'auto' },
        startId!,
      )
      .then((result) => {
        if (!result.success) {
          cleanup()
          resolve({ ok: false, error: result.error || 'Stream init failed' })
        }
      })
      .catch((err: Error) => {
        cleanup()
        resolve({ ok: false, error: err.message })
      })
  })
}

export function stopLLMWorker(): void {
  for (const off of unsubscribers) off()
  unsubscribers = []
  bound = false
  currentStreamId = null
}

function sanitizeHistoryForLLM(messages: ChatMessage[]): ChatMessage[] {
  const hasImages = (m: ChatMessage): boolean =>
    Array.isArray(m.content) &&
    m.content.some((p) => p.type === 'image_url')
  let lastImageIdx = -1
  messages.forEach((m, i) => {
    if (m.role === 'user' && hasImages(m)) lastImageIdx = i
  })
  return messages.map((m, i) => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return m
    if (i === lastImageIdx) return m
    const parts = m.content
    const texts = parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text)
    const imageCount = parts.filter((p) => p.type === 'image_url').length
    const marker = imageCount > 0 ? `[图片×${imageCount}]` : ''
    const text = [...texts, marker].filter(Boolean).join('\n')
    return { ...m, content: text }
  })
}

function toDialogMessage(item: LLMDialogueItem): LLMDialogMessage {
  const card = activeRoleCard
  const msg: LLMDialogMessage = {
    name: card?.displayName ?? card?.name ?? 'assistant',
    text: item.text,
  }
  if (typeof item.emotion === 'string' && item.emotion) msg.emotion = item.emotion
  if (typeof item.action === 'string' && item.action) {
    msg.motion = item.action
  }
  return msg
}
