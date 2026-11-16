import type { ChatMessage } from '@shared/types'
import { extractAssistantDisplayText } from '@shared/dialogue/protocol'

export interface SessionPreview {
  text: string
  ts: number | null
}

export function messageText(message: ChatMessage): string {
  const userText = (message as ChatMessage & { userText?: unknown }).userText
  if (typeof userText === 'string' && userText.trim()) return userText.trim()
  const raw = typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
  return message.role === 'assistant' ? extractAssistantDisplayText(raw) : raw.trim()
}

export function previewFromMessages(messages: readonly ChatMessage[]): SessionPreview {
  const last = [...messages].reverse().find((message) => message.role === 'user' || message.role === 'assistant')
  if (!last) return { text: '', ts: null }

  let text = messageText(last)
  if (!text && Array.isArray(last.content) && last.content.some((part) => part.type === 'image_url')) {
    text = '图片'
  }
  return {
    text: text.replace(/\s+/g, ' ').trim().slice(0, 120),
    ts: typeof last.ts === 'number' ? last.ts : null,
  }
}

export function formatPreviewTime(ts: number | null, now = Date.now()): string {
  if (ts === null || !Number.isFinite(ts)) return ''
  const date = new Date(ts)
  const today = new Date(now)
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  if (ts >= todayStart) return time
  if (ts >= todayStart - 24 * 60 * 60 * 1000) return `昨天 ${time}`
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}
