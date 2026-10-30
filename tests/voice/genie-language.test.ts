import { afterEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const state = vi.hoisted(() => ({
  voice: {} as Record<string, unknown>,
  bodies: {} as Record<string, Record<string, unknown>>,
}))

vi.mock('../../src/main/services/paths', () => ({ resolveVoicePath: (value: string) => value }))
vi.mock('../../src/main/services/roleCardLoader', () => ({
  readRoleVoiceConfig: () => state.voice,
  resolveRoleVoiceFile: (_card: unknown, value: string) => value,
}))
vi.mock('../../src/main/services/ttsPort', () => ({
  applyTtsPortShift: (value: string) => value,
  assertLocalBaseURL: () => {},
}))
vi.mock('../../src/main/services/logBus', () => ({
  logBus: { info: () => {}, warn: () => {}, error: () => {} },
}))

import { GenieAdapter } from '../../src/main/services/tts/genieAdapter'

const existing = path.resolve('package.json')

function config(): Record<string, unknown> {
  return {
    enabled: true,
    provider: 'genie',
    baseURL: 'http://127.0.0.1:39999',
    characterName: 'test',
    onnxModelDir: existing,
    referenceAudioRelPath: existing,
    referenceText: '参考文本',
    referenceLanguage: 'zh',
    outputLanguage: 'auto',
  }
}

function stubGenie(): void {
  vi.stubGlobal('fetch', (url: string, init: { body?: string } = {}) => {
    const endpoint = String(url).split('/').pop()!
    state.bodies[endpoint] = JSON.parse(init.body ?? '{}')
    if (endpoint === 'tts') return Promise.resolve(new Response(new Uint8Array(Buffer.alloc(32_000 * 2)), { status: 200 }))
    return Promise.resolve(Response.json({ status: 'success' }))
  })
}

afterEach(() => {
  state.bodies = {}
  vi.unstubAllGlobals()
})

describe('GenieAdapter 语言配置', () => {
  it('英文参考音频可用于中文角色的跨语言合成', async () => {
    state.voice = {
      referenceText: 'And now, I belong to this set.',
      referenceLanguage: 'en',
      outputLanguage: 'auto',
    }
    stubGenie()

    await new GenieAdapter().generateSpeech({
      text: '你好',
      globalConfig: config(),
      card: { language: 'zh' },
    } as never)

    expect(state.bodies.load_character?.language).toBe('zh')
    expect(state.bodies.set_reference_audio?.language).toBe('en')
  })

  it('目标合成语言与角色语言不一致时仍然拒绝', async () => {
    state.voice = {
      referenceText: '参考文本',
      referenceLanguage: 'zh',
      outputLanguage: 'en',
    }
    stubGenie()

    await expect(new GenieAdapter().generateSpeech({
      text: '你好',
      globalConfig: config(),
      card: { language: 'zh' },
    } as never)).rejects.toThrow('角色说话语言')
  })
})
