import type { LLMConfig, LLMRequest, LLMResponse } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { readConfig } from './configStore'
import { chooseAdapter } from './llm/factory'
import { logBus } from './logBus'

function resolveSettings(request: LLMRequest): LLMConfig {
  const config = readConfig()
  const settings: LLMConfig = { ...config.llm, ...(request.overrides ?? {}) }
  if (!settings.apiKey) throw new Error('API key is not configured')
  if (!settings.baseURL) {
    throw new Error('Base URL is not configured')
  }
  if (!settings.modelName) throw new Error('Model name is not configured')
  return settings
}

function describeMessages(messages: LLMRequest['messages']): string {
  return messages
    .map((m, i) => {
      const text =
        typeof m.content === 'string'
          ? m.content
          : m.content.map((p) => (p.type === 'text' ? p.text : '[图片]')).join(' ')
      return `[${i}] ${m.role}: ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`
    })
    .join('\n')
}

export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const settings = resolveSettings(request)
  const adapter = chooseAdapter(settings)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  logBus.info(
    'llm',
    `请求开始 (non-stream) provider=${settings.provider} model=${settings.modelName}`,
    describeMessages(request.messages),
  )
  try {
    const res = await adapter.chat({
      messages: request.messages,
      config: settings,
      signal: controller.signal,
      tools: request.tools,
      toolChoice: request.toolChoice,
    })
    logBus.info('llm', `请求完成 (non-stream)`, res.content.slice(0, 500))
    return res
  } catch (err) {
    logBus.error('llm', `请求失败 (non-stream): ${(err as Error).message}`, (err as Error).stack)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const activeStreams = new Map<string, AbortController>()

export function abortStream(streamId: string): void {
  const controller = activeStreams.get(streamId)
  if (controller) {
    controller.abort()
    activeStreams.delete(streamId)
  }
}

export async function callLLMStream(
  request: LLMRequest,
  streamId: string,
  sender: BrowserWindow['webContents'],
): Promise<void> {
  const settings = resolveSettings(request)
  const adapter = chooseAdapter(settings)
  const controller = new AbortController()
  activeStreams.set(streamId, controller)
  const timer = setTimeout(() => controller.abort(), 180_000)

  logBus.info(
    'llm',
    `请求开始 (stream id=${streamId}) provider=${settings.provider} model=${settings.modelName}`,
    describeMessages(request.messages),
  )

  let contentChars = 0
  let reasoningChars = 0
  const contentBuf: string[] = []

  try {
    await adapter.chatStream(
      { messages: request.messages, config: settings, signal: controller.signal, tools: request.tools, toolChoice: request.toolChoice },
      {
        onContent: (delta) => {
          contentChars += delta.length
          contentBuf.push(delta)
          sender.send('llm:stream:chunk', streamId, delta)
        },
        onReasoning: (delta) => {
          reasoningChars += delta.length
          sender.send('llm:stream:reasoning', streamId, delta)
        },
        onToolCalls: (calls) => {
          sender.send('llm:stream:tool_calls', streamId, calls)
        },
        onWarning: (msg) => {
          logBus.warn('llm', msg)
        },
      },
    )
    sender.send('llm:stream:done', streamId)
    logBus.info(
      'llm',
      `请求完成 (stream id=${streamId}) content=${contentChars}字 reasoning=${reasoningChars}字`,
      contentBuf.join('').slice(0, 800),
    )
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      sender.send('llm:stream:done', streamId)
      logBus.warn('llm', `请求中断 (stream id=${streamId})`)
    } else {
      sender.send('llm:stream:error', streamId, (err as Error).message)
      logBus.error(
        'llm',
        `请求失败 (stream id=${streamId}): ${(err as Error).message}`,
        (err as Error).stack,
      )
    }
  } finally {
    clearTimeout(timer)
    activeStreams.delete(streamId)
  }
}
