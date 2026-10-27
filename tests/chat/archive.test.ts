import { beforeEach, describe, expect, it, vi } from 'vitest'

const history = {
  append: vi.fn(),
  replaceAll: vi.fn(),
  archiveRange: vi.fn(),
}

;(globalThis as unknown as { window: unknown }).window = {
  opengal: { chatHistory: history },
}

import { useChatStore } from '../../src/renderer/src/features/chat/chatStore'

function resetStore(): void {
  useChatStore.setState({
    sessionId: 'c-test',
    messages: [],
    persistError: null,
    isSending: false,
    error: null,
    streamingSegments: [],
  })
}

describe('chat archive boundary', () => {
  beforeEach(async () => {
    history.append.mockReset().mockResolvedValue({ success: true, data: [1] })
    history.replaceAll.mockReset().mockResolvedValue({ success: true, data: true })
    history.archiveRange.mockReset().mockResolvedValue({ success: true, data: 2 })
    resetStore()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('缺少数据库 ID 时保持本地消息不变', async () => {
    useChatStore.setState({
      messages: [
        { role: 'user', content: 'a', userText: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c', userText: 'c' },
      ],
    })
    history.archiveRange.mockClear()

    await useChatStore.getState().archiveFront(2)

    expect(useChatStore.getState().messages).toHaveLength(3)
    expect(history.archiveRange).not.toHaveBeenCalled()
  })

  it('持久化失败时写入 persistError', async () => {
    history.append.mockRejectedValue(new Error('disk full'))

    useChatStore.getState().appendUser('hello')

    await vi.waitFor(() => {
      expect(useChatStore.getState().persistError).toContain('disk full')
    })
  })

  it('append 返回 ID 数量不匹配时视为失败', async () => {
    history.append.mockResolvedValue({ success: true, data: [] })

    useChatStore.getState().appendUser('hello')

    await vi.waitFor(() => {
      expect(useChatStore.getState().persistError).toContain('返回值不完整')
    })
  })
})
