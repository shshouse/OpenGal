import type { ChatMessage, LLMResponse } from '@shared/types'
import type { LLMAdapter, LLMChatRequest, LLMStreamCallbacks } from './types'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source:
        | { type: 'base64'; media_type: string; data: string }
        | { type: 'url'; url: string }
    }
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
      conv.push({ role: m.role, content: convertContent(m.content) })
    }
  }
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
    let currentBlockType: 'text' | 'thinking' | 'other' = 'other'

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
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
