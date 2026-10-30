import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TTSConfig } from '../../src/shared/types'

const state = vi.hoisted(() => ({
  ttsCalls: 0,
  responses: [] as Buffer[],
  lastTtsBody: '',
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

const REF_SECONDS = 4
const PCM_RATE = 32_000

function pcmOfSeconds(seconds: number): Buffer {
  return Buffer.alloc(Math.round(seconds * PCM_RATE) * 2)
}

let workDir = ''
let modelDir = ''
let refAudio = ''

function config(): TTSConfig {
  return {
    enabled: true,
    provider: 'genie',
    baseURL: 'http://127.0.0.1:39880',
    gptModelRelPath: '',
    sovitsModelRelPath: '',
    characterName: 'probe',
    onnxModelDir: modelDir,
    referenceAudioRelPath: refAudio,
    referenceText: '参考文本',
    referenceLanguage: 'zh',
    outputLanguage: 'zh',
    speedFactor: 1,
    textSplitMethod: 'cut5',
  }
}

describe('Genie 合成结果校验', () => {
  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-genie-output-'))
    modelDir = path.join(workDir, 'tts_models')
    fs.mkdirSync(modelDir, { recursive: true })
    refAudio = path.join(workDir, 'prompt.wav')
    // 4 秒、24k、单声道 16bit 的参考音，只为提供 byteRate 供时长换算
    const byteRate = 24_000 * 2
    const data = Buffer.alloc(byteRate * REF_SECONDS)
    const header = Buffer.alloc(44)
    header.write('RIFF', 0, 'ascii')
    header.writeUInt32LE(36 + data.length, 4)
    header.write('WAVE', 8, 'ascii')
    header.write('fmt ', 12, 'ascii')
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(24_000, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36, 'ascii')
    header.writeUInt32LE(data.length, 40)
    fs.writeFileSync(refAudio, Buffer.concat([header, data]))

    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (input.endsWith('/load_character') || input.endsWith('/set_reference_audio') || input.endsWith('/stop')) {
        return new Response('{}', { status: 200 })
      }
      state.lastTtsBody = String(init?.body ?? '')
      const body = state.responses[Math.min(state.ttsCalls, state.responses.length - 1)]
      state.ttsCalls += 1
      return new Response(new Uint8Array(body), { status: 200 })
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    state.ttsCalls = 0
    state.responses = []
  })

  it('第一次复读参考音时自动重试，第二次正常则采用', async () => {
    state.responses = [pcmOfSeconds(REF_SECONDS + 0.28), pcmOfSeconds(1.2)]
    const adapter = new GenieAdapter()
    const res = await adapter.generateSpeech({ text: '你好呀，维尔汀。', globalConfig: config(), card: null })
    expect(state.ttsCalls).toBe(2)
    // 返回的是第二次的 1.2 秒音频（44 字节头 + PCM）
    const bytes = Buffer.from(res.audioBase64, 'base64')
    expect(bytes.length).toBe(44 + pcmOfSeconds(1.2).length)
  })

  it('连续两次复读参考音则放弃这段语音', async () => {
    state.responses = [pcmOfSeconds(REF_SECONDS + 0.28), pcmOfSeconds(REF_SECONDS + 0.2)]
    const adapter = new GenieAdapter()
    await expect(
      adapter.generateSpeech({ text: '你好呀，维尔汀。', globalConfig: config(), card: null }),
    ).rejects.toThrow(/复读参考音|结果异常/)
    expect(state.ttsCalls).toBe(2)
  })

  it('空音频同样视为失败并重试', async () => {
    state.responses = [Buffer.alloc(0), pcmOfSeconds(1.1)]
    const adapter = new GenieAdapter()
    const res = await adapter.generateSpeech({ text: '午饭吃了没？', globalConfig: config(), card: null })
    expect(state.ttsCalls).toBe(2)
    expect(res.audioBase64).toBeTruthy()
  })

  it('正常时长的音频不触发重试', async () => {
    state.responses = [pcmOfSeconds(1.9)]
    const adapter = new GenieAdapter()
    await adapter.generateSpeech({ text: '我还以为你要说什么大事呢。', globalConfig: config(), card: null })
    expect(state.ttsCalls).toBe(1)
  })

  it('中文模型下把 G2P 会崩的「嗯」换成「恩」再送合成', async () => {
    state.responses = [pcmOfSeconds(1.2)]
    const adapter = new GenieAdapter()
    await adapter.generateSpeech({ text: '嗯，我知道了。', globalConfig: config(), card: null })
    expect(JSON.parse(state.lastTtsBody).text).toBe('恩，我知道了。')
  })
})
