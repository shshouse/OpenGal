/**
 * OpenAI-Compatible LLM 适配器。
 *
 * 支持所有走 OpenAI Chat Completions 协议的供应商：
 * OpenAI / OpenRouter / DeepSeek / Doubao / Qwen DashScope / SiliconFlow / 本地 vLLM 等。
 * 流式响应支持 `reasoning_content` 字段（DeepSeek-R1 / Doubao）以及内联 `<think>` 标签
 * （Qwen-QwQ / 自蒸馏 R1）的拆分。
 */

import type { LLMConfig, LLMResponse, ToolCall } from '@shared/types'
import type { LLMAdapter, LLMChatRequest, LLMStreamCallbacks } from './types'

/**
 * 决定 thinking 字段：
 * - config.thinking 显式指定 -> 按用户设置（enabled/disabled + budget）
 * - 未指定 -> 兼容旧逻辑：DeepSeek 系模型默认关闭（对话场景思考会占用大量
 *   max_tokens 导致 content 通道空、无法输出 JSON）
 *
 * 实现方式：把 `thinking: { type: 'disabled' }` 放在请求体顶层（DeepSeek 服务端识别该字段，
 * 其他 OpenAI 兼容 provider 会忽略 unknown 字段，无副作用）。
 *
 * 判断依据：以前只看 baseURL 是否 deepseek.com，但用户经常通过 OpenRouter / 国内代理访问
 * deepseek 模型，baseURL 不含 deepseek.com 但 modelName 含 "deepseek"。改为按 modelName 匹配
 * 才能覆盖代理场景（参考 RachelForster 按 model 名做 provider 路由）。
 */
function isDeepSeek(config: LLMConfig): boolean {
  return /deepseek/i.test(config.modelName) || /(?:^|\/\/)(?:[^/]*\.)?deepseek\.com/i.test(config.baseURL)
}

interface ChatBody {
  model: string
  messages: unknown
  temperature: number
  max_tokens: number
  stream?: boolean
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
    // 思考模型（DeepSeek-V4-*、o1、qwq 等）会把整段推理塞进 reasoning_content，
    // max_tokens 同时计入 reasoning + content。2048 经常被思考耗尽导致 content 为空。
    // 默认 8192 兼顾普通对话模型与思考模型。
    max_tokens: config.maxTokens ?? 8192,
    // OpenAI 兼容协议的官方 JSON Mode：强制模型返回单个合法 JSON。
    // 注意：启用 tools 时关闭 JSON Mode（OpenAI 不允许两者同时使用）。
    // 必须判 tools?.length：空数组是真值，漏判会让 JSON Mode 在「没有注册任何
    // 工具」时被静默关闭，输出格式完全退化为靠提示词约束
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

export class OpenAIAdapter implements LLMAdapter {
  async chat(req: LLMChatRequest): Promise<LLMResponse> {
    const { config, messages, signal } = req
    if (!config.apiKey) throw new Error('API key is not configured')
    if (!config.baseURL) throw new Error('Base URL is not configured')
    if (!config.modelName) throw new Error('Model name is not configured')

    const url = `${config.baseURL.replace(/\/$/, '')}/chat/completions`
    const body = buildChatBody(config, messages, false, req.tools, req.toolChoice)

    const response = await fetch(url, {
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
    }
    const message = data.choices?.[0]?.message
    const content = (message?.content ?? '').trim()
    const toolCalls = message?.tool_calls
    if (!content && !toolCalls?.length) throw new Error('Empty response from LLM')
    return { content, toolCalls }
  }

  async chatStream(req: LLMChatRequest, callbacks: LLMStreamCallbacks): Promise<void> {
    const { config, messages, signal } = req
    if (!config.apiKey) throw new Error('API key is not configured')
    if (!config.baseURL) throw new Error('Base URL is not configured')
    if (!config.modelName) throw new Error('Model name is not configured')

    const url = `${config.baseURL.replace(/\/$/, '')}/chat/completions`
    const body = buildChatBody(config, messages, true, req.tools, req.toolChoice)

    const response = await fetch(url, {
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
    if (!response.body) throw new Error('No response body for streaming')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let truncated = false
    const thinkState = { insideThinkBlock: false }

    // OpenAI 流式 tool_calls 是按 index 分片增量：
    // 第一条 delta 带 id/name/arguments:""，后续 delta 只补 arguments 字符串片段。
    // 我们按 index 拼装，最后一次性 yield。
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
        const reasoningField = delta?.reasoning_content
        if (reasoningField) callbacks.onReasoning?.(reasoningField)
        const chunk = delta?.content
        if (chunk) {
          const { content, reasoning } = splitChunk(chunk, thinkState)
          if (reasoning) callbacks.onReasoning?.(reasoning)
          if (content) callbacks.onContent(content)
        }
        // 累积 tool_calls 增量
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
          callbacks.onWarning?.('LLM 输出被 max_tokens 截断，回复可能不完整。建议调高 maxTokens。')
          break
        }
      }
    }

    // 流结束：把 tool_calls 攒出来一次性回调（按 index 升序）
    if (toolCallAccum.size > 0) {
      const indices = Array.from(toolCallAccum.keys()).sort((a, b) => a - b)
      const calls: ToolCall[] = []
      for (const idx of indices) {
        const acc = toolCallAccum.get(idx)!
        if (!acc.id || !acc.name) continue  // 不完整，丢弃
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

/**
 * 把单个 SSE chunk 拆成「正文 content」和「思维链 reasoning」两路。
 *
 * - DeepSeek-R1 / Qwen-QwQ 等模型把思维链包在 <think>...</think> 或 <thinking>...</thinking> 内
 * - 思维链可能跨 chunk（半个块尾、半个下个块头），用 state.insideThinkBlock 保留状态
 * - 一个 chunk 里可能既有正文又有 reasoning（开始进 think、未结束）
 */
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
