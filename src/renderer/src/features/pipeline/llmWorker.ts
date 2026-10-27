import { SpeechStreamParser, buildSystemPrompt, extractAssistantDisplayText } from '@shared/roleCard'
import { packContext, type ContextItem } from './contextAssembler'
import type { ChatMessage, LLMDialogueItem, MessageContentPart, ToolCall, ToolDefinition } from '@shared/types'
import type { LLMDialogMessage, UserInputMessage } from '@shared/messages'
import { useChatStore } from '@/features/chat/chatStore'
import { useToolCallsStore, type ToolCallRecord } from '@/features/tools/toolCallsStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { getAvailableMotionGroups } from '@/features/live2d/live2dBus'
import { getMemorySnapshot, setMemorySnapshot } from '@/features/memory/snapshot'
import { pipelineBus } from './pipelineBus'
import { getActiveRoleCard } from './activeCard'
import { calibratePromptTokens, computeContextUsage, estimateTokens, messageText, promptRawTokens, type ContextUsage } from './llmContext'
import { compressHistory, getCachedSummariesText } from './llmCompression'
import { fetchEnvBlock } from './llmEnv'

let counter = 0
let currentStreamId: string | null = null
let bound = false
let unsubscribers: Array<() => void> = []
let accumulatedReasoning = ''
let accumulatedRaw = ''
let displayTextThisTurn = ''
let latencyTurnStart = 0
let firstTokenLogged = false
let firstDialogLogged = false

async function fetchRelevantMemory(characterId: string, context: string): Promise<string | null> {
  try {
    const res = await window.opengal.memory.getRelevant(characterId, context.slice(0, 500))
    if (res.success && res.data?.block) {
      setMemorySnapshot(characterId, res.data.block)
      return res.data.block
    }
    if (!res.success) {
      useLogsStore.getState().appendLocal('warn', 'memory', `向量记忆检索失败: ${res.error ?? 'unknown'}`)
    }
  } catch (err) {
    useLogsStore.getState().appendLocal('warn', 'memory', `向量记忆检索异常: ${(err as Error).message}`)
  }
  return getMemorySnapshot(characterId) ?? null
}

let pendingPromptRawTokens = 0

export function getLastRawResponse(): string {
  return accumulatedRaw
}

export function getContextUsage(): ContextUsage | null {
  const card = getActiveRoleCard()
  if (!card) return null
  const history = useChatStore.getState().messages
  const motionGroups = getAvailableMotionGroups()
  const memoryBlock = getMemorySnapshot(card.id) ?? undefined
  const systemContent = buildSystemPrompt(card, motionGroups, memoryBlock)
  return computeContextUsage(systemContent, memoryBlock, history, resolveTurnBudget(), getCachedSummariesText())
}

let globalContextWindow: number | null = null

export function setGlobalContextWindow(n: number): void {
  globalContextWindow = n
}

// 上下文窗口：模型物理窗口，用于显示上限
function resolveContextWindow(): number {
  return getActiveRoleCard()?.llm?.contextWindow ?? globalContextWindow ?? 1048576
}

// 每轮实际发送预算：默认按 1M 窗口设计，超出再靠 50% 阈值压缩
const MAX_TURN_BUDGET = 1_048_576

function resolveTurnBudget(): number {
  return Math.min(resolveContextWindow(), MAX_TURN_BUDGET)
}

const MAX_TOOL_ROUNDS = 5
const MAX_RETRIES = 1
const RETRY_BASE_MS = 2000
const TURN_DEADLINE_MS = 5 * 60_000
const SCREENSHOT_MARKER = 'OPENGAL_SCREENSHOT:'

function isRetryableError(error: string): boolean {
  return /timeout|network|ECONNRESET|502|503|504|rate limit|overloaded/i.test(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function logLatency(stage: string): void {
  if (latencyTurnStart <= 0) return
  useLogsStore
    .getState()
    .appendLocal('info', 'latency', `${stage} +${Math.round(performance.now() - latencyTurnStart)}ms`)
}

export function startLLMWorker(): () => void {
  if (bound) {
    return stopLLMWorker
  }
  bound = true
  const parser = new SpeechStreamParser()

  let dialogCountThisTurn = 0
  let turnSeq = 0

  const emitDialog = (item: LLMDialogueItem): void => {
    const card = getActiveRoleCard()
    dialogCountThisTurn++
    displayTextThisTurn += item.text
    if (!firstDialogLogged && latencyTurnStart > 0) {
      firstDialogLogged = true
      logLatency('firstDialog')
    }
    pipelineBus.emit('llm:dialog', {
      ...toDialogMessage(item, latencyTurnStart),
      segmentId: crypto.randomUUID(),
      characterId: card?.id,
      language: card?.language,
    })
  }

  const offUserInput = pipelineBus.on('user:input', (input: UserInputMessage) => {
    if (!getActiveRoleCard()) {
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
    resetForNewAttempt()

    const myTurn = ++turnSeq
    void runTurn(input.text, myTurn, input.systemPrompt).catch((err: Error) => {
      if (myTurn !== turnSeq) return
      currentStreamId = null
      pipelineBus.emit('llm:done', { ok: false, error: err.message })
    })
  })

  async function runTurn(userText: string, myTurn: number, systemPrompt?: string): Promise<void> {
    const card = getActiveRoleCard()
    if (!card) return
    const stale = (): boolean => myTurn !== turnSeq
    const turnStartedAt = Date.now()
    const history = useChatStore.getState().messages
    const motionGroups = getAvailableMotionGroups()
    const [memoryBlock, toolsResp] = await Promise.all([
      fetchRelevantMemory(card.id, userText),
      window.opengal.tools.list(),
    ])
    if (stale()) return
    const tools: ToolDefinition[] = toolsResp.success && toolsResp.data ? toolsResp.data : []
    const systemContent = buildSystemPrompt(
      card,
      motionGroups,
      memoryBlock ?? undefined,
      tools.length > 0,
    )
    const compressedHistory = await compressHistory(
      card.id,
      history,
      resolveTurnBudget(),
      estimateTokens(systemContent),
      stale,
    )

    const envMsg = await fetchEnvBlock()
    const contextItems: ContextItem[] = [
      { id: 'system', message: { role: 'system', content: systemContent }, priority: 1000 },
    ]
    if (envMsg) {
      contextItems.push({ id: 'env', message: { ...envMsg, contextTag: 'env' }, priority: 800 })
    }
    sanitizeHistoryForLLM(compressedHistory).forEach((message, index) => {
      contextItems.push({
        id: `history-${index}`,
        message,
        // 摘要段代表更长的历史，优先于任何单条原文；原文越新优先级越高
        priority: message.contextTag === 'summary' ? 700 : 100 + index,
      })
    })
    if (systemPrompt) {
      contextItems.push({
        id: 'intent',
        message: { role: 'user', content: systemPrompt, contextTag: 'intent' },
        priority: 950,
      })
    }
    if (stale()) return
    const packed = packContext(contextItems, resolveTurnBudget(), (message) =>
      estimateTokens(messageText(message)),
    )
    if (packed.droppedIds.length > 0) {
      useLogsStore
        .getState()
        .appendLocal(
          'warn',
          'context',
          `上下文预算不足，丢弃 ${packed.droppedIds.length} 段：${packed.droppedIds.slice(0, 6).join(', ')}${packed.droppedIds.length > 6 ? '…' : ''}`,
        )
    }
    let messagesForLLM: ChatMessage[] = packed.messages

    pendingPromptRawTokens = promptRawTokens(messagesForLLM)
    const firstResult = await runStreamRoundWithRetry(messagesForLLM, tools, stale)
    if (stale()) return
    if (!firstResult.ok) {
      currentStreamId = null
      pipelineBus.emit('llm:done', { ok: false, error: firstResult.error })
      return
    }
    if (!firstResult.toolCalls || firstResult.toolCalls.length === 0) {
      finalizeAndEmit(accumulatedRaw, parser, () => parser.flush().forEach(emitDialog))
      return
    }
    // 工具调用前已生成的短句先吐出来，避免被后续非流式续传覆盖
    parser.flush().forEach(emitDialog)
    messagesForLLM = messagesForLLM.concat([
      {
        role: 'assistant',
        content: firstResult.assistantContent,
        tool_calls: firstResult.toolCalls,
      },
    ])

    let lastRoundSigs = ''
    let repeatStreak = 0

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (stale()) return
      if (Date.now() - turnStartedAt > TURN_DEADLINE_MS) {
        currentStreamId = null
        pipelineBus.emit('llm:done', { ok: false, error: '本轮对话超时（工具循环过长），已终止' })
        return
      }

      const prevToolCalls = messagesForLLM[messagesForLLM.length - 1].tool_calls ?? []
      const roundSigs = prevToolCalls
        .map((tc) => `${tc.function.name}:${tc.function.arguments}`)
        .join('|')

      const toolMessages: ChatMessage[] = []
      const imageMessages: ChatMessage[] = []

      if (roundSigs && roundSigs === lastRoundSigs) {
        repeatStreak++
        if (repeatStreak >= 2) {
          useLogsStore.getState().appendLocal('warn', 'llm-worker', '工具连续重复调用，判定循环停滞，终止本轮')
          currentStreamId = null
          pipelineBus.emit('llm:done', { ok: false, error: '工具循环停滞（连续相同调用），已终止' })
          return
        }
        for (const tc of prevToolCalls) {
          toolMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: '重复调用已拦截：与上一轮完全相同的工具调用，不会重复执行。请勿再重试同一调用，直接基于已有结果回复用户。',
          })
        }
      } else {
        repeatStreak = 0
        for (const tc of prevToolCalls) {
          const start = performance.now()
          const exec = await window.opengal.tools.execute(tc.function.name, tc.function.arguments)
          if (stale()) return
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
          if (ok && resultContent.startsWith(SCREENSHOT_MARKER)) {
            const dataUrl = resultContent.slice(SCREENSHOT_MARKER.length)
            toolMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.function.name,
              content: '已拍摄屏幕截图，图片见紧随其后的消息。',
            })
            imageMessages.push({
              role: 'user',
              content: [
                { type: 'text', text: '[系统注入的屏幕截图，供你查看用户当前屏幕]' },
                { type: 'image_url', image_url: { url: dataUrl } },
              ] as MessageContentPart[],
            })
          } else {
            toolMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.function.name,
              content: resultContent,
            })
          }
        }
      }
      lastRoundSigs = roundSigs
      messagesForLLM = messagesForLLM.concat(toolMessages, imageMessages)

      const roundRawTokens = promptRawTokens(messagesForLLM)
      const nonStream = await window.opengal.llm.chat({
        messages: messagesForLLM,
        overrides: card.llm,
        tools,
        toolChoice: 'auto',
      })
      if (stale()) return
      if (!nonStream.success) {
        currentStreamId = null
        pipelineBus.emit('llm:done', { ok: false, error: nonStream.error || 'Tool 续传失败' })
        return
      }
      const data = nonStream.data!
      calibratePromptTokens(data.usage?.promptTokens, roundRawTokens)
      const assistantContent = data.content || ''
      const toolCalls = data.toolCalls

      const tmpParser = new SpeechStreamParser()
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

  async function runStreamRoundWithRetry(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    stale: () => boolean,
  ): Promise<
    | { ok: true; assistantContent: string; toolCalls: ToolCall[] | undefined }
    | { ok: false; error: string }
  > {
    let lastError = ''
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (stale()) return { ok: false, error: 'Reply interrupted' }
      if (attempt > 0) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1)
        useLogsStore.getState().appendLocal('info', 'llm-worker', `LLM 请求重试 ${attempt}/${MAX_RETRIES}，等待 ${delay}ms`)
        await sleep(delay)
      }
      if (stale()) return { ok: false, error: 'Reply interrupted' }
      const result = await runStreamRound(messages, tools)
      if (result.ok) return result
      lastError = result.error
      if (!isRetryableError(result.error)) break
    }
    return { ok: false, error: lastError }
  }

  function resetForNewAttempt(): void {
    parser.reset()
    accumulatedReasoning = ''
    accumulatedRaw = ''
    displayTextThisTurn = ''
    dialogCountThisTurn = 0
    latencyTurnStart = performance.now()
    firstTokenLogged = false
    firstDialogLogged = false
    useToolCallsStore.getState().clear()
    currentStreamId = `stream_${++counter}_${Date.now()}`
  }

  function finalizeAndEmit(
    rawContent: string,
    p: SpeechStreamParser,
    flush: () => void,
  ): void {
    flush()
    if (dialogCountThisTurn === 0) {
      const raw = (rawContent || accumulatedRaw).trim()
      const reasoning = accumulatedReasoning.trim()
      if (raw) {
        const text = extractAssistantDisplayText(raw)
        if (text) {
          useLogsStore
            .getState()
            .appendLocal(
              'warn',
              'llm-worker',
              'LLM 未按台词格式输出，已用 fallback 包装为单条 text',
              raw.slice(0, 2000),
            )
          emitDialog({ text })
        } else {
          useLogsStore
            .getState()
            .appendLocal('warn', 'llm-worker', 'LLM 输出没有可播放的台词', raw.slice(0, 2000))
        }
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
    logLatency('llmDone')
    currentStreamId = null
    pipelineBus.emit('llm:done', { ok: true, displayText: displayTextThisTurn })
  }

  const offChunk = window.opengal.llm.onStreamChunk((id, chunk) => {
    if (id !== currentStreamId) return
    if (!firstTokenLogged) {
      firstTokenLogged = true
      logLatency('firstToken')
    }
    accumulatedRaw += chunk
    const items = parser.feed(chunk)
    for (const item of items) emitDialog(item)
  })

  const offReasoning = window.opengal.llm.onStreamReasoning((id, delta) => {
    if (id !== currentStreamId) return
    accumulatedReasoning += delta
    pipelineBus.emit('llm:reasoning', { delta, accumulated: accumulatedReasoning })
  })

  const offUsage = window.opengal.llm.onStreamUsage((id, usage) => {
    if (id !== currentStreamId) return
    calibratePromptTokens(usage.promptTokens, pendingPromptRawTokens)
    pendingPromptRawTokens = 0
  })

  const offError = window.opengal.llm.onStreamError((id, error) => {
   if (id !== currentStreamId) return
    useLogsStore.getState().appendLocal('error', 'llm-worker', `LLM 流错误: ${error}`)
  })

  const offAbort = pipelineBus.on('pipeline:abort', () => {
    turnSeq++
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

  unsubscribers = [offUserInput, offChunk, offReasoning, offUsage, offError, offAbort]
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
        { messages, overrides: getActiveRoleCard()?.llm, tools, toolChoice: 'auto' },
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

function toDialogMessage(item: LLMDialogueItem, turnStartedAt: number): LLMDialogMessage {
  const card = getActiveRoleCard()
  const msg: LLMDialogMessage = {
    name: card?.displayName ?? card?.name ?? 'assistant',
    text: item.text,
  }
  if (turnStartedAt > 0) msg.turnStartedAt = turnStartedAt
  if (typeof item.emotion === 'string' && item.emotion) msg.emotion = item.emotion
  if (typeof item.action === 'string' && item.action) {
    msg.motion = item.action
  }
  return msg
}
