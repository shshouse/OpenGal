import { DialogueStreamParser, buildSystemPrompt } from '@shared/roleCard'
import type { ChatMessage, LLMDialogueItem, MessageContentPart, RoleCard, ToolCall, ToolDefinition } from '@shared/types'
import type { LLMDialogMessage, UserInputMessage } from '@shared/messages'
import { useChatStore } from '@/features/chat/chatStore'
import { useToolCallsStore, type ToolCallRecord } from '@/features/tools/toolCallsStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { getAvailableMotionGroups } from '@/features/live2d/live2dBus'
import { getMemorySnapshot, setMemorySnapshot } from '@/features/memory/snapshot'
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

const COMPRESSION_THRESHOLD = 0.8
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

function messageText(m: ChatMessage): string {
  return typeof m.content === 'string'
    ? m.content
    : m.content.map((p) => (p.type === 'text' ? p.text : '')).join(' ')
}

interface ContextUsage {
  systemTokens: number
  memoryTokens: number
  historyTokens: number
  totalTokens: number
  maxTokens: number
}

// 按需取相关记忆：优先用向量检索（getRelevant），失败时回退到快照
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

function estimateTokens(text: string): number {
  let tokens = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x4e00 && code <= 0x9fff) {
      tokens += 2
    } else if (code >= 0x3000 && code <= 0x303f) {
      tokens += 1
    } else {
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}

function computeContextUsage(
  systemContent: string,
  memoryBlock: string | undefined,
  history: ChatMessage[],
  maxTokens: number,
): ContextUsage {
  const systemTokens = estimateTokens(systemContent)
  const memoryTokens = memoryBlock ? estimateTokens(memoryBlock) : 0
  const historyTokens =
    history.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0) +
    (cachedSummariesText ? estimateTokens(cachedSummariesText) : 0)
  return {
    systemTokens,
    memoryTokens,
    historyTokens,
    totalTokens: systemTokens + memoryTokens + historyTokens,
    maxTokens,
  }
}

export function getLastRawResponse(): string {
  return accumulatedRaw
}

export function getContextUsage(): ContextUsage | null {
  if (!activeRoleCard) return null
  const history = useChatStore.getState().messages
  const motionGroups = getAvailableMotionGroups()
  const memoryBlock = getMemorySnapshot(activeRoleCard.id) ?? undefined
  const systemContent = buildSystemPrompt(activeRoleCard, motionGroups, memoryBlock)
  return computeContextUsage(systemContent, memoryBlock, history, resolveContextWindow())
}

let globalMaxTokens = 4096
let globalContextWindow: number | null = null

export function setGlobalMaxTokens(n: number): void {
  globalMaxTokens = n
}

export function setGlobalContextWindow(n: number): void {
  globalContextWindow = n
}

function resolveMaxTokens(): number {
  return activeRoleCard?.llm?.maxTokens ?? globalMaxTokens
}

// 上下文窗口：压缩阈值与用量显示的口径；输出上限（max_tokens）与此无关
function resolveContextWindow(): number {
  return activeRoleCard?.llm?.contextWindow ?? globalContextWindow ?? resolveMaxTokens()
}

const MAX_TOOL_ROUNDS = 5
const MAX_RETRIES = 1
const RETRY_BASE_MS = 2000
const TURN_DEADLINE_MS = 5 * 60_000
const SCREENSHOT_MARKER = 'OPENGAL_SCREENSHOT:'

function buildEnvBlock(env: {
  timeText: string
  idleSeconds: number
  justReturned: boolean
  awayMinutes: number
  game: { name: string; fullscreen: boolean } | null
  foreground: { app: string; title: string; fullscreen: boolean } | null
}): string {
  const lines = [`现在时间：${env.timeText}`]
  if (env.justReturned) {
    lines.push(`用户刚刚离开了约 ${env.awayMinutes} 分钟，现在回来了`)
  }
  if (env.game) {
    lines.push(
      `用户正在玩游戏《${env.game.name}》${env.game.fullscreen ? '（全屏中）' : ''}——回复要更简短，不要频繁打扰`,
    )
  } else if (env.foreground?.fullscreen && env.foreground.app) {
    lines.push(`用户正在全屏使用 ${env.foreground.app}`)
  } else if (env.foreground?.app) {
    lines.push(`用户当前前台应用：${env.foreground.app}`)
  }
  if (env.idleSeconds > 300) {
    lines.push(`用户已约 ${Math.round(env.idleSeconds / 60)} 分钟没有操作电脑`)
  }
  return `【当前环境】\n${lines.join('\n')}`
}

async function fetchEnvBlock(): Promise<ChatMessage | null> {
  try {
    const res = await window.opengal.env.get()
    if (res.success && res.data) {
      return { role: 'system', content: buildEnvBlock(res.data) }
    }
  } catch {
    /* 环境信息可选，失败不阻塞对话 */
  }
  return null
}

function isRetryableError(error: string): boolean {
  return /timeout|network|ECONNRESET|502|503|504|rate limit|overloaded/i.test(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 存档式压缩：超阈值时把旧段摘要追加进 L1（SQLite summaries 分段），原文标记 archived 永不删除
// 返回值 = [既往摘要消息(若有), ...可用历史]
async function compressHistory(
  characterId: string,
  history: ChatMessage[],
  contextWindow: number,
  systemTokens: number,
): Promise<ChatMessage[]> {
  const summariesText = await loadSummariesText(characterId)
  const summaryMessage: ChatMessage | null = summariesText
    ? { role: 'system', content: `[既往对话摘要]\n${summariesText}` }
    : null

  const summaryTokens = summariesText ? estimateTokens(summariesText) : 0
  const historyTokens = history.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0)
  const budget = contextWindow * COMPRESSION_THRESHOLD - systemTokens - summaryTokens
  if (historyTokens <= budget) {
    return summaryMessage ? [summaryMessage, ...history] : history
  }

  const keepRecent = Math.max(10, Math.floor(history.length * 0.3))
  if (history.length <= keepRecent) {
    return summaryMessage ? [summaryMessage, ...history] : history
  }
  const toCompress = history.slice(0, history.length - keepRecent)
  const recent = history.slice(history.length - keepRecent)

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

  if (!res.success || !res.data?.content) {
    useLogsStore.getState().appendLocal('warn', 'llm-worker', '历史压缩失败，跳过本轮压缩')
    return summaryMessage ? [summaryMessage, ...history] : history
  }

  const newText = res.data.content.trim()
  // 兜底：压缩后仍超阈值则放弃归档，保原文返回（避免归档与注入脱节）
  const newSummaryTokens = summaryTokens + estimateTokens(newText)
  const newTotal = systemTokens + newSummaryTokens + recent.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0)
  if (newTotal > contextWindow) {
    useLogsStore.getState().appendLocal('warn', 'llm-worker', `压缩后仍超窗口 (${newTotal}/${contextWindow})，放弃本轮归档`)
    return summaryMessage ? [summaryMessage, ...history] : history
  }

  await window.opengal.chatHistory.summaryAdd(characterId, {
    start_ts: Date.now(),
    end_ts: Date.now(),
    text: newText,
    message_count: toCompress.length,
  })
  await useChatStore.getState().archiveFront(toCompress.length)

  useLogsStore.getState().appendLocal(
    'info',
    'llm-worker',
    `存档压缩: ${toCompress.length} 条归档，新摘要段 ${estimateTokens(newText)} tokens`,
  )

  return [{ role: 'system', content: `[既往对话摘要]\n${summariesText ? summariesText + '\n' : ''}${newText}` }, ...recent]
}

export function startLLMWorker(): () => void {
  if (bound) {
    return stopLLMWorker
  }
  bound = true

  const parser = new DialogueStreamParser()

  let dialogCountThisTurn = 0
  let retryCount = 0

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
    resetForNewAttempt()

    void runTurn(input.text).catch((err: Error) => {
      currentStreamId = null
      pipelineBus.emit('llm:done', { ok: false, error: err.message })
    })
  })

  async function runTurn(userText: string): Promise<void> {
    const turnStartedAt = Date.now()
    const history = useChatStore.getState().messages
    const motionGroups = getAvailableMotionGroups()
    const memoryBlock = await fetchRelevantMemory(activeRoleCard!.id, userText)
    const systemContent = buildSystemPrompt(
      activeRoleCard!,
      motionGroups,
      memoryBlock ?? undefined,
    )
    const compressedHistory = await compressHistory(
      activeRoleCard!.id,
      history,
      resolveContextWindow(),
      estimateTokens(systemContent),
    )

    let messagesForLLM: ChatMessage[] = [
      { role: 'system', content: systemContent },
    ]
    const envMsg = await fetchEnvBlock()
    if (envMsg) messagesForLLM.push(envMsg)
    messagesForLLM.push(...sanitizeHistoryForLLM(compressedHistory))

    const toolsResp = await window.opengal.tools.list()
    const tools: ToolDefinition[] = toolsResp.success && toolsResp.data ? toolsResp.data : []

    const firstResult = await runStreamRoundWithRetry(messagesForLLM, tools)
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

    let lastRoundSigs = ''
    let repeatStreak = 0

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
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

  async function runStreamRoundWithRetry(
    messages: ChatMessage[],
    tools: ToolDefinition[],
  ): Promise<
    | { ok: true; assistantContent: string; toolCalls: ToolCall[] | undefined }
    | { ok: false; error: string }
  > {
    let lastError = ''
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1)
        useLogsStore.getState().appendLocal('info', 'llm-worker', `LLM 请求重试 ${attempt}/${MAX_RETRIES}，等待 ${delay}ms`)
        await sleep(delay)
      }
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
    dialogCountThisTurn = 0
    useToolCallsStore.getState().clear()
    currentStreamId = `stream_${++counter}_${Date.now()}`
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

  const offError = window.opengal.llm.onStreamError(async (id, error) => {
    if (id !== currentStreamId) return
    useLogsStore.getState().appendLocal('error', 'llm-worker', `LLM 流错误: ${error}`)
    if (retryCount < MAX_RETRIES && isRetryableError(error)) {
      retryCount++
      useLogsStore.getState().appendLocal('info', 'llm-worker', `流错误将重试 (${retryCount}/${MAX_RETRIES})`)
      resetForNewAttempt()
      const history = useChatStore.getState().messages
      const motionGroups = getAvailableMotionGroups()
      const memoryBlock = await fetchRelevantMemory(activeRoleCard!.id, history.slice(-3).map((m) => messageText(m)).join(' '))
      const systemContent = buildSystemPrompt(
        activeRoleCard!,
        motionGroups,
        memoryBlock ?? undefined,
      )
      const contextHistory = await compressHistory(
        activeRoleCard!.id,
        history,
        resolveContextWindow(),
        estimateTokens(systemContent),
      )
      const messages: ChatMessage[] = [
        { role: 'system', content: systemContent },
        ...sanitizeHistoryForLLM(contextHistory),
      ]
      void runStreamRoundWithRetry(messages, [])
        .then((result) => {
          if (!result.ok) {
            currentStreamId = null
            pipelineBus.emit('llm:done', { ok: false, error: result.error })
          }
        })
        .catch(() => {
          currentStreamId = null
          pipelineBus.emit('llm:done', { ok: false, error })
        })
      return
    }
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
    retryCount = 0
    if (wasStreaming) {
      pipelineBus.emit('llm:done', { ok: true })
    }
  })

  unsubscribers = [offUserInput, offChunk, offReasoning, offDone, offError, offAbort]
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
