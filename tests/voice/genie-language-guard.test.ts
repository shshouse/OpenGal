import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TTSConfig } from '../../src/shared/types'

const state = vi.hoisted(() => ({
  fetched: [] as string[],
}))

vi.mock('../../src/main/services/paths', () => ({
  resolveVoicePath: (rel: string) => rel,
}))
vi.mock('../../src/main/services/roleCardLoader', () => ({
  readRoleVoiceConfig: () => null,
  resolveRoleVoiceFile: (_card: unknown, rel: string) => rel,
}))
vi.mock('../../src/main/services/ttsPort', () => ({
  applyTtsPortShift: (url: string) => url,
  assertLocalBaseURL: () => {},
}))
vi.mock('../../src/main/services/logBus', () => ({
  logBus: { info: () => {}, warn: () => {}, error: () => {} },
}))

import { GenieAdapter } from '../../src/main/services/tts/genieAdapter'

let workDir = ''
let modelDir = ''
let refAudio = ''

function config(overrides: Partial<TTSConfig> = {}): TTSConfig {
  return {
    enabled: true,
    provider: 'genie',
    baseURL: 'http://127.0.0.1:39880',
    gptModelRelPath: '',
    sovitsModelRelPath: '',
    characterName: 'probe',
    onnxModelDir: modelDir,
    referenceAudioRelPath: refAudio,
    referenceText: 'And now, I belong to this set.',
    referenceLanguage: 'en',
    outputLanguage: 'en',
    speedFactor: 1,
    textSplitMethod: 'cut5',
    ...overrides,
  }
}

describe('Genie 台词语言守卫', () => {
  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-genie-guard-'))
    modelDir = path.join(workDir, 'tts_models')
    fs.mkdirSync(modelDir, { recursive: true })
    refAudio = path.join(workDir, 'prompt.wav')
    fs.writeFileSync(refAudio, '')
    vi.stubGlobal('fetch', async (input: string) => {
      state.fetched.push(input)
      if (input.endsWith('/load_character') || input.endsWith('/set_reference_audio')) {
        return new Response('{}', { status: 200 })
      }
      return new Response(new Uint8Array(Buffer.alloc(32_000 * 2)), { status: 200 })
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  it('中文台词配英文音色模型时拒绝合成，不把参考音当台词播', async () => {
    const adapter = new GenieAdapter()
    state.fetched.length = 0
    await expect(
      adapter.generateSpeech({ text: '你好呀，维尔汀。', globalConfig: config(), card: null }),
    ).rejects.toThrow(/参考音频/)
    expect(state.fetched).toEqual([])
  })

  it('英文台词正常走合成', async () => {
    const adapter = new GenieAdapter()
    state.fetched.length = 0
    const res = await adapter.generateSpeech({
      text: 'Hello there, how are you?',
      globalConfig: config(),
      card: null,
    })
    expect(res.audioBase64).toBeTruthy()
    expect(state.fetched.some((url) => url.endsWith('/tts'))).toBe(true)
  })
})
