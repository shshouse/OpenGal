/**
 * LLMWorker：消费 `user:input`，调用主进程 LLM 流式 API，把流转译为 `llm:dialog` 与 `llm:reasoning`。
 *
 * 对齐 RachelForster 的 `LLMWorker` (`core/runtime/workers.py`)：
 * - LLM 流的 reasoning 增量走单独通道（不混入 JSON 解析缓冲区）
 * - 文本块进入 `DialogueStreamParser`，每解析出一条 JSON 立即广播
 * - 一轮结束后广播 `llm:done`
 *
 * M3 扩展：
 * - 工具调用（function calling）：检测到 tool_calls 时执行工具，把结果回填 messages
 *   并再次调用 LLM（用非流式 chat()，简化续传），重复直到 LLM 不再请求工具
 *
 * 注意：当前主进程 `cleanChunk` 已经把 `<think>` 标签清掉，因此 reasoning 通道暂时为空。
 * M1.6 会让主进程把 reasoning 拆成独立 channel 后此处自动接收。
 */

import { DialogueStreamParser, buildSystemPrompt } from '@shared/roleCard'
import type { ChatMessage, LLMDialogueItem, RoleCard, ToolCall, ToolDefinition } from '@shared/types'
import type { LLMDialogMessage, UserInputMessage } from '@shared/messages'
import { useChatStore } from '@/features/chat/chatStore'
import { useToolCallsStore, type ToolCallRecord } from '@/features/tools/toolCallsStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { pipelineBus } from './pipelineBus'

let counter = 0
let currentStreamId: string | null = null
let bound = false
let unsubscribers: Array<() => void> = []
let activeRoleCard: RoleCard | null = null
let accumulatedReasoning = ''
/**
 * 累积当前一轮 LLM 的全部原始 chunk 文本。
 * 当解析不出任何 dialog segment 时，会把这段放进错误信息让用户能定位
 * "LLM 实际返回了什么"——区分 LLM 没按 JSON 协议输出 / 返回空 / 走错模型。
 */
let accumulatedRaw = ''

/**
 * 注入当前激活的角色卡。M2 会把这里换成「角色管理器」的订阅。
 */
export function setActiveRoleCard(card: RoleCard): void {
  activeRoleCard = card
}

/**
 * 取本轮 LLM 原始返回（未经 parser 处理）。用于在解析失败时把
 * 实际内容暴露给用户，帮助定位是 LLM 没按 JSON 协议输出 / 返回空 / 模型错误。
 */
export function getLastRawResponse(): string {
  return accumulatedRaw
}

const MAX_TOOL_ROUNDS = 5  // 防止工具循环死锁

/**
 * 启动 LLMWorker。返回 dispose 用于卸载。
 */
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
    // 本轮工具调用记录：每个 user turn 一次性清空
    useToolCallsStore.getState().clear()

    // 先设 currentStreamId 供 runStreamRound 锁定本轮 id，再启动 runTurn
    currentStreamId = `stream_${++counter}_${Date.now()}`

    void runTurn(input.text).catch((err: Error) => {
      currentStreamId = null
      pipelineBus.emit('llm:done', { ok: false, error: err.message })
    })
  })

  // 处理 tool 循环 + 流式首轮 + 续传非流式
  async function runTurn(userText: string): Promise<void> {
    // 取最新 chat history 快照，避免和 abort 中途被覆盖的版本混淆
    const history = useChatStore.getState().messages

    const systemContent = buildSystemPrompt(activeRoleCard!)

    let messagesForLLM: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...history,
    ]

    // 工具定义：注册到主进程工具表
    const toolsResp = await window.opengal.tools.list()
    const tools: ToolDefinition[] = toolsResp.success && toolsResp.data ? toolsResp.data : []

    // 第一轮：流式（沿用原有流式管线）
    const firstResult = await runStreamRound(messagesForLLM, tools)
    if (!firstResult.ok) {
      currentStreamId = null
      pipelineBus.emit('llm:done', { ok: false, error: firstResult.error })
      return
    }
    // 整轮首轮流式 chunk 已被全局 offChunk 喂给 parser 并 emit dialog。
    // 把 assistant（含 tool_calls）加入 messages 进入工具循环
    if (!firstResult.toolCalls || firstResult.toolCalls.length === 0) {
      // 没有 tool 调用：流式回复已是最终回答
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

    // 工具循环：执行 tool → 续传 LLM（非流式） → 直到无 tool 调用或超限
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // 上一轮 assistant message 已在 messagesForLLM 末尾；现在执行 tool
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
        // 写入 UI 工具调用 store，让用户能在气泡下方看到这次调用
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
        // 把工具结果也作为可见 reasoning 片段广播给用户，便于调试
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

      // 非流式续传 LLM
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

      // 续传内容走 parser，输出 dialog 段
      const tmpParser = new DialogueStreamParser()
      for (const it of tmpParser.feed(assistantContent)) emitDialog(it)
      for (const it of tmpParser.flush()) emitDialog(it)

      if (toolCalls && toolCalls.length > 0) {
        // 还有 tool 调用：把 assistant 加入 messages 进入下一轮
        messagesForLLM = messagesForLLM.concat([
          { role: 'assistant', content: assistantContent, tool_calls: toolCalls },
        ])
        continue
      }
      // 终轮：finalize 写入历史
      accumulatedRaw = assistantContent
      finalizeAndEmit(assistantContent, parser, () => {})
      return
    }

    // 超过 MAX_TOOL_ROUNDS
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
      // 同原有 fallback 逻辑
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
    // 第一轮流式 done 由 runStreamRound 自己处理；这里只兜底（不应被触发）
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

  unsubscribers = [offUserInput, offChunk, offReasoning, offDone, offError, offAbort]
  return stopLLMWorker
}

/**
 * 执行一次流式 LLM 调用，返回结果（包含 toolCalls）。
 *
 * 不在这里订阅 IPC chunk——全局 offChunk 已经会喂给 parser 并累积到
 * accumulatedRaw。本函数只负责：
 * 1. 记下 assistantContent 快照（用于续传 messages）
 * 2. 捕获 tool_calls（通过 onToolCalls 回调）
 * 3. 在 done 时 resolve
 */
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

    const startId = currentStreamId  // 锁定本轮 stream id

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

    // 发起流式请求。currentStreamId 已经在 caller 里设过。
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

/**
 * 把解析出的 LLM JSON 单元转成总线消息。
 */
function toDialogMessage(item: LLMDialogueItem): LLMDialogMessage {
  const card = activeRoleCard
  const msg: LLMDialogMessage = {
    name: card?.displayName ?? card?.name ?? 'assistant',
    text: item.text,
  }
  if (typeof item.emotion === 'string' && item.emotion) msg.emotion = item.emotion
  if (typeof item.action === 'string' && item.action) msg.effect = item.action
  return msg
}
