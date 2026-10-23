import { SpeechStreamParser, buildSystemPrompt, extractAssistantDisplayText } from '@shared/roleCard'
import { packContext, type ContextItem } from './contextAssembler'
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
let displayTextThisTurn = ''
let latencyTurnStart = 0
let firstTokenLogged = false
let firstDialogLogged = false

export function setActiveRoleCard(card: RoleCard): void {
  if (activeRoleCard && activeRoleCard.id !== card.id) pipelineBus.emit('pipeline:abort', undefined)
  activeRoleCard = card
}

// 上下文预算按 1M 窗口设计：默认全局配置为 1M，且只信任模型真实窗口
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

let tokenCalibration = 1
let pendingPromptRawTokens = 0

function rawEstimateTokens(text: string): number {
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

// 用 API 返回的 prompt_tokens 校准估算，避免中文分词误差导致压缩时机失真
function estimateTokens(text: string): number {
  return Math.ceil(rawEstimateTokens(text) * tokenCalibration)
}

function calibratePromptTokens(actualPrompt: number | undefined, rawEstimate: number): void {
  if (!actualPrompt || actualPrompt <= 0 || rawEstimate <= 0) return
  const ratio = actualPrompt / rawEstimate
  if (ratio < 0.3 || ratio > 3) return
  tokenCalibration = ratio
  useLogsStore
    .getState()
    .appendLocal('info', 'llm-worker', `分词校准 ${ratio.toFixed(2)}x（实测 ${actualPrompt} / 估算 ${rawEstimate}）`)
}

function promptRawTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + rawEstimateTokens(messageText(m)) + 8, 0)
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
  return computeContextUsage(systemContent, memoryBlock, history, resolveTurnBudget())
}

let globalContextWindow: number | null = null

export function setGlobalContextWindow(n: number): void {
  globalContextWindow = n
}

// 上下文窗口：模型物理窗口，用于显示上限
function resolveContextWindow(): number {
  return activeRoleCard?.llm?.contextWindow ?? globalContextWindow ?? 1048576
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
// 头部若干条始终保留，避免把开场设定摘要掉
async function compressHistory(
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
    dialogCountThisTurn++
    displayTextThisTurn += item.text
    if (!firstDialogLogged && latencyTurnStart > 0) {
      firstDialogLogged = true
      logLatency('firstDialog')
    }
    pipelineBus.emit('llm:dialog', {
      ...toDialogMessage(item, latencyTurnStart),
      segmentId: crypto.randomUUID(),
      characterId: activeRoleCard?.id,
      language: activeRoleCard?.language,
    })
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

    const myTurn = ++turnSeq
    void runTurn(input.text, myTurn, input.systemPrompt).catch((err: Error) => {
      if (myTurn !== turnSeq) return
      currentStreamId = null
      pipelineBus.emit('llm:done', { ok: false, error: err.message })
    })
  })

  async function runTurn(userText: string, myTurn: number, systemPrompt?: string): Promise<void> {
    const stale = (): boolean => myTurn !== turnSeq
    const turnStartedAt = Date.now()
    const history = useChatStore.getState().messages
    const motionGroups = getAvailableMotionGroups()
    const [memoryBlock, toolsResp] = await Promise.all([
      fetchRelevantMemory(activeRoleCard!.id, userText),
      window.opengal.tools.list(),
    ])
    if (stale()) return
    const tools: ToolDefinition[] = toolsResp.success && toolsResp.data ? toolsResp.data : []
    const systemContent = buildSystemPrompt(
      activeRoleCard!,
      motionGroups,
      memoryBlock ?? undefined,
      tools.length > 0,
    )
    const compressedHistory = await compressHistory(
      activeRoleCard!.id,
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
        overrides: activeRoleCard!.llm,
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

function toDialogMessage(item: LLMDialogueItem, turnStartedAt: number): LLMDialogMessage {
  const card = activeRoleCard
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
