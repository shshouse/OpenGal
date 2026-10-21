import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  signal: null as AbortSignal | null,
  adapter: null as null | {
    checkAvailability: () => { ok: boolean }
    generateSpeech: (args: { signal: AbortSignal }) => Promise<{ audioBase64: string; mimeType: string }>
  },
}))

vi.mock('../../src/main/services/configStore', () => ({
  readConfig: () => ({ tts: { enabled: true, provider: 'genie' }, activeCharacterId: null }),
}))
vi.mock('../../src/main/services/roleCardLoader', () => ({ getRoleCard: () => null }))
vi.mock('../../src/main/services/ttsServer', () => ({ startGptSovitsServer: async () => {} }))
vi.mock('../../src/main/services/logBus', () => ({
  logBus: { info: () => {}, warn: () => {}, error: () => {} },
}))
vi.mock('../../src/main/services/tts/factory', () => ({
  chooseTTSAdapter: () => state.adapter,
  resetAllTTSAdapters: () => {},
}))

import { cancelSpeech, speak, warmupTTS } from '../../src/main/services/ttsClient'

describe('ttsClient cancellation', () => {
  it('取消会传到 adapter，且下一次合成仍可用', async () => {
    state.adapter = {
      checkAvailability: () => ({ ok: true }),
      generateSpeech: ({ signal }) => {
        state.signal = signal
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }),
        )
      },
    }
    const request = speak({ text: 'old speech' })
    cancelSpeech()
    expect(state.signal?.aborted).toBe(true)
    expect((await request).skipped).toBe(true)

    state.adapter.generateSpeech = async () => ({ audioBase64: 'new', mimeType: 'audio/wav' })
    expect((await speak({ text: 'new speech' })).audioBase64).toBe('new')
  })

  it('取消也能中止 warmup', async () => {
    state.adapter = {
      checkAvailability: () => ({ ok: true }),
      generateSpeech: ({ signal }) => {
        state.signal = signal
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }),
        )
      },
    }
    const warmup = warmupTTS()
    cancelSpeech()
    expect(state.signal?.aborted).toBe(true)
    expect(await warmup).toBe(false)
  })
})
