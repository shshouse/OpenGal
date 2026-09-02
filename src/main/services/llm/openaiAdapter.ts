import type { LLMConfig, LLMResponse, ToolCall } from '@shared/types'
import { logBus } from '../logBus'
import type { LLMAdapter, LLMChatRequest, LLMStreamCallbacks } from './types'
import { normalizeOpenAIUsage } from './usage'
function isDeepSeek(config: LLMConfig): boolean {
  return /deepseek/i.test(config.modelName) || /(?:^|\/\/)(?:[^/]*\.)?deepseek\.com/i.test(config.baseURL)
}

interface ChatBody {
  model: string
  messages: unknown
  temperature: number
  max_tokens: number
  stream?: boolean
  stream_options?: { include_usage: boolean }
  response_format?: { type: 'json_object' }
  thinking?: { type: 'enabled' | 'disabled'; budget_tokens?: number }
  tools?: unknown[]
  tool_choice?: unknown
}

function buildChatBody(
  config: LLMConfig,
  messages: unknown,
  stream: boolean,
  tools?: unknown[],
  toolChoice?: unknown,
): ChatBody {
  const body: ChatBody = {
    model: config.modelName,
    messages,
    temperature: config.temperature ?? 0.86,
    max_tokens: config.maxTokens ?? 8192,
    response_format: tools?.length ? undefined : { type: 'json_object' },
  }
  if (stream) body.stream = true
  if (config.thinking === false) {
    body.thinking = { type: 'disabled' }
  } else if (config.thinking === true) {
    body.thinking = { type: 'enabled', budget_tokens: config.thinkingBudget ?? 1024 }
  } else if (isDeepSeek(config)) {
    body.thinking = { type: 'disabled' }
  }
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = toolChoice ?? 'auto'
  }
  return body
}

async function fetchLLM(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    const e = err as Error & { cause?: unknown }
    const cause = e.cause instanceof Error ? e.cause.message : String(e.cause ?? '')
    throw new Error(`无法连接 LLM 服务（${url}）：${e.message}${cause ? `（原因: ${cause}）` : ''}`)
  }
}

export class OpenAIAdapter implements LLMAdapter {
  async chat(req: LLMChatRequest): Promise<LLMResponse> {
    const { config, messages, signal } = req
    if (!config.apiKey) throw new Error('API key is not configured')
    if (!config.baseURL) throw new Error('Base URL is not configured')
    if (!config.modelName) throw new Error('Model name is not configured')

    const url = `${config.baseURL.replace(/\/$/, '')}/chat/completions`
    const body = buildChatBody(config, messages, false, req.tools, req.toolChoice)

    const response = await fetchLLM(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`LLM error ${response.status}: ${errText.slice(0, 500)}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null
          tool_calls?: ToolCall[]
        }
        finish_reason?: string | null
      }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const message = data.choices?.[0]?.message
    const content = (message?.content ?? '').trim()
    const toolCalls = message?.tool_calls
    if (!content && !toolCalls?.length) throw new Error('Empty response from LLM')
    const usage = normalizeOpenAIUsage(data.usage)
    return { content, toolCalls, ...(usage ? { usage } : {}) }
  }

  async chatStream(req: LLMChatRequest, callbacks: LLMStreamCallbacks): Promise<void> {
    const { config, messages, signal } = req
    if (!config.apiKey) throw new Error('API key is not configured')
    if (!config.baseURL) throw new Error('Base URL is not configured')
    if (!config.modelName) throw new Error('Model name is not configured')

    const url = `${config.baseURL.replace(/\/$/, '')}/chat/completions`
    const body = buildChatBody(config, messages, true, req.tools, req.toolChoice)
    body.stream_options = { include_usage: true }
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    }
    let response = await fetchLLM(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok && response.status === 400) {
      // 部分兼容端点不认识 stream_options，去掉重试一次，代价是本轮无 usage
      delete body.stream_options
      response = await fetchLLM(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
    }
    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`LLM error ${response.status}: ${errText.slice(0, 500)}`)
    }
    if (!response.body) throw new Error('No response body for streaming')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let truncated = false
    let lastUsage: ReturnType<typeof normalizeOpenAIUsage> = null
    const thinkState = { insideThinkBlock: false }
    const toolCallAccum = new Map<number, { id: string; name: string; args: string }>()

    while (true) {
      const { done, value } = await reader.read()
      if (done || truncated) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue

        let parsed: {
          error?: { message?: string; code?: string; type?: string } | string
          choices?: Array<{
            delta?: {
              content?: string
              reasoning_content?: string
              tool_calls?: Array<{
                index: number
                id?: string
                type?: 'function'
                function?: { name?: string; arguments?: string }
              }>
            }
            finish_reason?: string | null
          }>
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        }
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        if (parsed.error) {
          const msg =
            typeof parsed.error === 'string'
              ? parsed.error
              : parsed.error.message || JSON.stringify(parsed.error)
          throw new Error(`LLM stream error: ${msg}`)
        }
        const choice = parsed.choices?.[0]
        const delta = choice?.delta
        const streamUsage = normalizeOpenAIUsage(parsed.usage)
        if (streamUsage) lastUsage = streamUsage
        const reasoningField = delta?.reasoning_content
        if (reasoningField) callbacks.onReasoning?.(reasoningField)
        const chunk = delta?.content
        if (chunk) {
          const { content, reasoning } = splitChunk(chunk, thinkState)
          if (reasoning) callbacks.onReasoning?.(reasoning)
          if (content) callbacks.onContent(content)
        }
        for (const tc of delta?.tool_calls ?? []) {
          let acc = toolCallAccum.get(tc.index)
          if (!acc) {
            acc = { id: tc.id ?? '', name: '', args: '' }
            toolCallAccum.set(tc.index, acc)
          }
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name = tc.function.name
          if (tc.function?.arguments) acc.args += tc.function.arguments
        }
        if (choice?.finish_reason === 'length') {
          truncated = true
          logBus.warn('llm', 'LLM 输出被 max_tokens 截断，回复不完整。设置里调高 maxTokens')
          callbacks.onWarning?.('LLM 输出被 max_tokens 截断，回复可能不完整。建议调高 maxTokens。')
          break
        }
      }
    }
    if (lastUsage) callbacks.onUsage?.(lastUsage)
    if (toolCallAccum.size > 0) {
      const indices = Array.from(toolCallAccum.keys()).sort((a, b) => a - b)
      const calls: ToolCall[] = []
      for (const idx of indices) {
        const acc = toolCallAccum.get(idx)!
        if (!acc.id || !acc.name) continue
        calls.push({
          id: acc.id,
          type: 'function',
          function: { name: acc.name, arguments: acc.args },
        })
      }
      if (calls.length > 0) callbacks.onToolCalls?.(calls)
    }
  }
}

function cleanResponse(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim()
}
function splitChunk(
  chunk: string,
  state: { insideThinkBlock: boolean },
): { content: string; reasoning: string } {
  let result = chunk
  let content = ''
  let reasoning = ''

  if (state.insideThinkBlock) {
    const closeIdx = result.indexOf('</think>')
    if (closeIdx === -1) {
      const closeIdx2 = result.indexOf('</thinking>')
      if (closeIdx2 === -1) {
        return { content: '', reasoning: result }
      }
      reasoning += result.slice(0, closeIdx2)
      result = result.slice(closeIdx2 + '</thinking>'.length)
      state.insideThinkBlock = false
    } else {
      reasoning += result.slice(0, closeIdx)
      result = result.slice(closeIdx + '</think>'.length)
      state.insideThinkBlock = false
    }
  }

  const openMatch = result.match(/<think(?:ing)?>/i)
  if (openMatch && openMatch.index !== undefined) {
    content += result.slice(0, openMatch.index)
    const after = result.slice(openMatch.index + openMatch[0].length)
    const closeMatch = after.match(/<\/think(?:ing)?>/i)
    if (closeMatch && closeMatch.index !== undefined) {
      reasoning += after.slice(0, closeMatch.index)
      content += after.slice(closeMatch.index + closeMatch[0].length)
    } else {
      reasoning += after
      state.insideThinkBlock = true
    }
  } else {
    content += result
  }

  return { content, reasoning }
}
