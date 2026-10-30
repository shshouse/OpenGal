import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const state = vi.hoisted(() => {
  const calls: Array<(value: unknown) => void> = []
  const warnings: unknown[] = []
  const localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
  ;(globalThis as unknown as { localStorage: typeof localStorage }).localStorage = localStorage
  return { calls, warnings, localStorage, sessionId: 'role' }
})

vi.mock('@/features/chat/chatStore', () => ({
  useChatStore: { getState: () => ({ sessionId: state.sessionId }) },
}))
vi.mock('@/features/logs/logsStore', () => ({
  useLogsStore: { getState: () => ({ appendLocal: (...args: unknown[]) => state.warnings.push(args) }) },
}))

describe('subtitle worker', () => {
  let mod: typeof import('../../src/renderer/src/features/pipeline/subtitles')
  let pipelineBus: typeof import('../../src/renderer/src/features/pipeline/pipelineBus').pipelineBus
  let stop: () => void

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
  const emit = (id: string, text: string, turn = 1, language = 'ja'): void => {
    pipelineBus.emit('llm:dialog', {
      segmentId: id,
      characterId: 'role',
      name: 'role',
      text,
      turnStartedAt: turn,
      language,
    } as never)
  }
  const complete = (index: number, translation: string): void => {
    state.calls[index]({ success: true, data: { content: JSON.stringify({ translation }) } })
  }

  beforeAll(async () => {
    vi.stubGlobal('window', {
      opengal: {
        config: {
          get: async () => ({
            success: true,
            data: { systemLocale: 'zh-CN', subtitles: { mode: 'bilingual', targetLanguage: 'system' } },
          }),
        },
        llm: {
          chat: () =>
            new Promise((resolve) => {
              state.calls.push(resolve as (value: unknown) => void)
            }),
        },
      },
      localStorage: state.localStorage,
    })
    mod = await import('../../src/renderer/src/features/pipeline/subtitles')
    const bus = await import('../../src/renderer/src/features/pipeline/pipelineBus')
    pipelineBus = bus.pipelineBus
    stop = mod.startSubtitleWorker()
  })

  afterAll(() => {
    stop?.()
    vi.unstubAllGlobals()
  })

  it('乱序翻译保持原文顺序，中断/切角色/失败不串台', async () => {
    state.localStorage.setItem = () => {
      throw new Error('quota exceeded')
    }
    emit('a', 'こんにちは。')
    emit('b', '元気？')
    await flush()
    expect(state.calls).toHaveLength(2)

    complete(1, '还好吗？')
    await flush()
    complete(0, '你好。')
    await flush()
    expect(mod.displaySubtitle('role', 'こんにちは。元気？')).toBe('こんにちは。元気？\n你好。还好吗？')
    expect(mod.displaySubtitle('role', ' こんにちは。元気？ ')).toBe('こんにちは。元気？\n你好。还好吗？')

    emit('c', '古い返事', 2)
    await flush()
    pipelineBus.emit('pipeline:abort', undefined)
    complete(2, '不应出现')
    await flush()
    expect(mod.displaySubtitle('role', '古い返事')).toBe('古い返事')

    emit('d', '切换角色', 3)
    await flush()
    state.sessionId = 'another-role'
    complete(3, '不应串到新角色')
    await flush()
    expect(mod.displaySubtitle('role', '切换角色')).toBe('切换角色')

    state.sessionId = 'role'
    emit('mismatched-language', 'And so she kept writing.', 4, 'zh')
    await flush()
    expect(state.calls).toHaveLength(5)
    complete(4, '于是她继续写作。')
    await flush()
    expect(mod.displaySubtitle('role', 'And so she kept writing.')).toBe('And so she kept writing.\n于是她继续写作。')

    emit('failure', '失敗', 5)
    await flush()
    state.calls[5]({ success: false, error: 'test failure' })
    await flush()
    expect(mod.displaySubtitle('role', '失敗')).toBe('失敗')
    expect(state.warnings).toHaveLength(1)

    mod.applySubtitleConfig({
      systemLocale: 'zh-CN',
      subtitles: { mode: 'translated', targetLanguage: 'en' },
    } as never)
    expect(mod.displaySubtitle('role', 'こんにちは。元気？')).toBe('こんにちは。元気？')

    emit('disposed', '終了', 6)
    await flush()
    stop()
    complete(6, 'not shown')
    await flush()
    expect(mod.displaySubtitle('role', '終了')).toBe('終了')

    const tts = readFileSync(path.resolve('src/renderer/src/features/pipeline/ttsWorker.ts'), 'utf8')
    expect(tts).not.toContain('msg.translate')
  })

  it('系统语言变化后丢弃仍在途的旧语言译文', async () => {
    mod.applySubtitleConfig({
      systemLocale: 'zh-CN',
      subtitles: { mode: 'bilingual', targetLanguage: 'system' },
    } as never)
    stop = mod.startSubtitleWorker()
    emit('locale-race', 'Hello.', 7, 'en')
    await flush()
    const callIndex = state.calls.length - 1

    mod.applySubtitleConfig({
      systemLocale: 'en-US',
      subtitles: { mode: 'bilingual', targetLanguage: 'system' },
    } as never)
    complete(callIndex, '你好。')
    await flush()

    expect(mod.displaySubtitle('role', 'Hello.')).toBe('Hello.')
  })

  it('未配置字幕时默认翻译到系统语言', () => {
    mod.applySubtitleConfig({ systemLocale: 'zh-Hans-CN' } as never)

    expect(mod.useSubtitleStore.getState().preferences).toEqual({
      mode: 'translated',
      targetLanguage: 'system',
    })
    expect(mod.useSubtitleStore.getState().systemLocale).toBe('zh-Hans-CN')
  })
})
