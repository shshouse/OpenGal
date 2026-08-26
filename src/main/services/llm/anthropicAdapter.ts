/**
 * Anthropic Claude 适配器。
 *
 * 参考协议：https://docs.anthropic.com/en/api/messages-streaming
 *
 * 与 OpenAI 协议差异：
 * - endpoint：/v1/messages
 * - 请求头：x-api-key + anthropic-version
 * - 系统提示作为顶层 `system` 字段，不在 messages 数组中
 * - messages 只能交替 user/assistant，第一条必须是 user
 * - 流式 SSE 多种 event：message_start / content_block_start / content_block_delta /
 *   content_block_stop / message_delta / message_stop / ping
 * - thinking content block（Claude 4 思考模式）走 `thinking` 类型
 */

import type { ChatMessage, LLMResponse } from '@shared/types'
import type { LLMAdapter, LLMChatRequest, LLMStreamCallbacks } from './types'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

/** Anthropic 多模态 content block：文本 / 图片（base64 source 或 url source）。 */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source:
        | { type: 'base64'; media_type: string; data: string }
        | { type: 'url'; url: string }
    }

/**
 * 把 OpenAI 兼容的 content 转成 Anthropic block 数组。
 * string 原样返回；多模态数组里 text 片段直通，image_url 转 image block：
 * data:base64 URL -> base64 source，http(s) URL -> url source。
 */
function convertContent(content: ChatMessage['content']): string | AnthropicContentBlock[] {
  if (!Array.isArray(content)) return content
  const blocks: AnthropicContentBlock[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'image_url') {
      const url = part.image_url.url
      const data = parseDataImageUrl(url)
      if (data) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: data[0], data: data[1] }
        })
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        blocks.push({ type: 'image', source: { type: 'url', url } })
      }
    }
  }
  return blocks
}

/** 解析 `data:image/png;base64,xxxx` -> [mediaType, data]；非 data URL 返回 null。 */
function parseDataImageUrl(url: string): [string, string] | null {
  if (!url.startsWith('data:')) return null
  const rest = url.slice('data:'.length)
  const commaIdx = rest.indexOf(',')
  if (commaIdx === -1) return null
  const meta = rest.slice(0, commaIdx)
  const data = rest.slice(commaIdx + 1)
  const media = meta.endsWith(';base64') ? meta.slice(0, -';base64'.length) : meta
  return [media, data]
}

function splitMessages(messages: ChatMessage[]): {
  system: string
  conv: Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }>
} {
  const systemParts: string[] = []
  const conv: Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }> = []
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') systemParts.push(m.content)
    } else if (m.role === 'user' || m.role === 'assistant') {
      // tool 消息目前 Anthropic 适配器不实现 tool_use 回传，
      // 把 tool 结果作为 user 消息注入（折中方案，后续补齐 tool_use blocks）
      conv.push({ role: m.role, content: convertContent(m.content) })
    }
    // role === 'tool' 暂时被丢弃：当前未实现 Anthropic tool_use 协议
  }
  // Claude 要求第一条必须是 user，并且 user/assistant 交替；这里只保证第一条不是 assistant。
  while (conv.length > 0 && conv[0].role === 'assistant') {
    conv.shift()
  }
  return { system: systemParts.join('\n\n'), conv }
}

export class AnthropicAdapter implements LLMAdapter {
  async chat(req: LLMChatRequest): Promise<LLMResponse> {
    const { config, messages, signal } = req
    if (!config.apiKey) throw new Error('API key is not configured')
    if (!config.modelName) throw new Error('Model name is not configured')

    const baseURL = (config.baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
    const { system, conv } = splitMessages(messages)
    const body: Record<string, unknown> = {
      model: config.modelName,
      max_tokens: config.maxTokens ?? 2048,
      temperature: config.temperature ?? 0.86,
      messages: conv,
    }
    if (system) body.system = system

    const response = await fetch(`${baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Claude error ${response.status}: ${errText.slice(0, 500)}`)
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>
    }
    const content = (data.content ?? [])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('')
      .trim()
    if (!content) throw new Error('Empty response from Claude')
    return { content }
  }

  async chatStream(req: LLMChatRequest, callbacks: LLMStreamCallbacks): Promise<void> {
    const { config, messages, signal } = req
    if (!config.apiKey) throw new Error('API key is not configured')
    if (!config.modelName) throw new Error('Model name is not configured')

    const baseURL = (config.baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
    const { system, conv } = splitMessages(messages)
    const body: Record<string, unknown> = {
      model: config.modelName,
      max_tokens: config.maxTokens ?? 2048,
      temperature: config.temperature ?? 0.86,
      messages: conv,
      stream: true,
    }
    if (system) body.system = system

    const response = await fetch(`${baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Claude error ${response.status}: ${errText.slice(0, 500)}`)
    }
    if (!response.body) throw new Error('No response body for streaming')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    // Claude 流通过 content_block_start 声明当前块的 type，content_block_delta 才是增量。
    // 我们记录当前块是 text 还是 thinking。
    let currentBlockType: 'text' | 'thinking' | 'other' = 'other'

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 事件以 "\n\n" 分隔；每个事件可能有 "event: xxx\ndata: {...}" 两行
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const raw of events) {
        const dataLine = raw
          .split('\n')
          .find((l) => l.startsWith('data:'))
        if (!dataLine) continue
        const payload = dataLine.slice(5).trim()
        if (!payload) continue
        try {
          const evt = JSON.parse(payload) as {
            type?: string
            content_block?: { type?: string }
            delta?: { type?: string; text?: string; thinking?: string }
          }
          if (evt.type === 'content_block_start') {
            const t = evt.content_block?.type
            currentBlockType =
              t === 'text' ? 'text' : t === 'thinking' ? 'thinking' : 'other'
          } else if (evt.type === 'content_block_delta') {
            const d = evt.delta
            if (!d) continue
            // text_delta -> 正文；thinking_delta -> reasoning
            if (d.type === 'text_delta' && d.text) {
              callbacks.onContent(d.text)
            } else if (d.type === 'thinking_delta' && d.thinking) {
              callbacks.onReasoning?.(d.thinking)
            } else if (currentBlockType === 'text' && d.text) {
              callbacks.onContent(d.text)
            } else if (currentBlockType === 'thinking' && d.thinking) {
              callbacks.onReasoning?.(d.thinking)
            }
          } else if (evt.type === 'content_block_stop') {
            currentBlockType = 'other'
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  }
}
