import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import {
  formatPreviewTime,
  messageText,
  previewFromMessages,
} from '../../src/renderer/src/features/chat/sessionPreview'

describe('session preview', () => {
  it('uses user text from content parts', () => {
    const message: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: '你好' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,xxx' } },
      ],
    }
    expect(messageText(message)).toBe('你好')
    expect(previewFromMessages([message])).toEqual({ text: '你好', ts: null })
  })

  it('extracts assistant dialogue text and keeps the latest timestamp', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '在吗', ts: 1000 },
      {
        role: 'assistant',
        content: JSON.stringify([{ type: 'dialogue', text: '我在' }]),
        ts: 2000,
      },
    ]
    expect(previewFromMessages(messages)).toEqual({ text: '我在', ts: 2000 })
  })

  it('falls back to an image marker for image-only messages', () => {
    const message: ChatMessage = {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,xxx' } }],
    }
    expect(previewFromMessages([message]).text).toBe('图片')
  })

  it('formats today, yesterday and older times', () => {
    const now = new Date(2026, 10, 16, 14, 30).getTime()
    expect(formatPreviewTime(new Date(2026, 10, 16, 9, 5).getTime(), now)).toBe('09:05')
    expect(formatPreviewTime(new Date(2026, 10, 15, 23, 48).getTime(), now)).toBe('昨天 23:48')
    expect(formatPreviewTime(new Date(2026, 9, 3, 11, 15).getTime(), now)).toBe('10月3日')
    expect(formatPreviewTime(new Date(2025, 8, 3, 11, 15).getTime(), now)).toBe('2025/9/3')
    expect(formatPreviewTime(null, now)).toBe('')
  })
})
