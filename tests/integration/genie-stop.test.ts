import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const state = vi.hoisted(() => ({ warnings: [] as string[], stopCalls: 0 }))

vi.mock('../../src/main/services/paths', () => ({ resolveVoicePath: (value: string) => value }))
vi.mock('../../src/main/services/roleCardLoader', () => ({
  readRoleVoiceConfig: () => null,
  resolveRoleVoiceFile: (_card: unknown, value: string) => value,
}))
vi.mock('../../src/main/services/ttsPort', () => ({
  applyTtsPortShift: (value: string) => value,
  assertLocalBaseURL: () => {},
}))
vi.mock('../../src/main/services/logBus', () => ({
  logBus: {
    info: () => {},
    warn: (message: string) => state.warnings.push(message),
    error: () => {},
  },
}))

import { GenieAdapter } from '../../src/main/services/tts/genieAdapter'

describe('GenieAdapter cancellation', () => {
  it('中止合成只发送一次 /stop，重复中止不重复发送', async () => {
    vi.stubGlobal('fetch', (url: string, init: { signal?: AbortSignal } = {}) => {
      if (String(url).endsWith('/stop')) {
        state.stopCalls++
        return Promise.resolve({ ok: true, status: 200 })
      }
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        })
      })
    })

    const existing = path.resolve('package.json')
    const config = {
      enabled: true,
      provider: 'genie',
      baseURL: 'http://127.0.0.1:39999',
      characterName: 'test',
      onnxModelDir: existing,
      referenceAudioRelPath: existing,
      referenceText: '参考文本',
      referenceLanguage: 'zh',
    }
    const adapter = new GenieAdapter()
    ;(adapter as unknown as { loadedCharacters: Map<string, Set<string>> }).loadedCharacters.set(
      'http://127.0.0.1:39999',
      new Set(['test']),
    )

    const controller = new AbortController()
    const pending = adapter.generateSpeech({
      text: '你好',
      globalConfig: config,
      card: null,
      signal: controller.signal,
    } as never)
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    await expect(pending).rejects.toBeTruthy()
    await new Promise((resolve) => setImmediate(resolve))
    expect(state.stopCalls).toBe(1)
    controller.abort()
    expect(state.stopCalls).toBe(1)
    expect(state.warnings).toHaveLength(0)
    vi.unstubAllGlobals()
  })
})
