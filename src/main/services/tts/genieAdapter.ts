import fs from 'node:fs'
import { roleSpeechLanguage } from '@shared/subtitles'
import type { RoleCardEntry, TTSConfig } from '@shared/types'
import { resolveVoicePath } from '../paths'
import { readRoleVoiceConfig, resolveRoleVoiceFile } from '../roleCardLoader'
import { applyTtsPortShift, assertLocalBaseURL } from '../ttsPort'
import { logBus } from '../logBus'
import type { TTSAdapter, TTSGenerateRequest, TTSGenerateResponse } from './types'

interface ResolvedGenieSettings {
  baseURL: string
  characterName: string
  onnxModelAbs: string
  refAudioAbs: string
  referenceText: string
  referenceLanguage: string
  outputLanguage: string
}

const GENIE_LANG_MAP: Record<string, string> = {
  zh: 'zh', en: 'en', ja: 'ja', ko: 'ko', yue: 'zh',
  auto: 'zh', auto_yue: 'zh',
  all_zh: 'zh', all_ja: 'ja', all_yue: 'zh', all_ko: 'ko',
}

function wrapPcmAsWav(buffer: Buffer): Buffer {
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF') return buffer
  const sampleRate = 32_000
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + buffer.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(buffer.length, 40)
  return Buffer.concat([header, buffer])
}

export class GenieAdapter implements TTSAdapter {
  readonly provider = 'genie'

  private loadedCharacters = new Map<string, Set<string>>()
  private stopping: Promise<unknown> = Promise.resolve()

  reset(): void {
    this.loadedCharacters.clear()
  }

  async ping(req: { globalConfig: TTSConfig; card?: RoleCardEntry | null }): Promise<{ ok: boolean; message?: string }> {
    const cfg = req.globalConfig
    if (!cfg.enabled) return { ok: false, message: 'TTS 未启用' }
    const cardVoice = req.card ? readRoleVoiceConfig(req.card) : null
    const base = applyTtsPortShift(normalizeBaseURL(String(cardVoice?.baseURL || cfg.baseURL)))
    if (!base) return { ok: false, message: 'TTS baseURL is not configured' }
    assertLocalBaseURL(base)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3_000)
    try {
      const res = await fetchReadable(`${base}/openapi.json`, { signal: controller.signal }, base)
      return { ok: true, message: `Genie API OK (HTTP ${res.status})` }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    } finally {
      clearTimeout(timer)
    }
  }

  checkAvailability(req: { globalConfig: TTSConfig; card?: RoleCardEntry | null }): { ok: boolean; reason?: string } {
    try {
      this.resolveSettings({ text: '', globalConfig: req.globalConfig, card: req.card ?? null })
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: (err as Error).message }
    }
  }

  async generateSpeech(req: TTSGenerateRequest): Promise<TTSGenerateResponse> {
    await this.stopping
    req.signal?.throwIfAborted()
    const text = req.text.trim()
    if (!text) throw new Error('Empty TTS input')

    const settings = this.resolveSettings(req)
    await this.ensureCharacterLoaded(settings, req.signal)
    req.signal?.throwIfAborted()

    const body = {
      character_name: settings.characterName,
      text,
      split_sentence: true,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120_000)
    let stopRequested = false
    const stopServer = (): void => {
      if (stopRequested) return
      stopRequested = true
      this.stopping = fetch(`${settings.baseURL}/stop`, {
        method: 'POST', signal: AbortSignal.timeout(2000),
      }).then((res) => {
        if (!res.ok) logBus.warn('tts', `Genie /stop 返回 HTTP ${res.status} baseURL=${settings.baseURL}`)
      }).catch((err: Error) => {
        logBus.warn('tts', `Genie /stop 失败: ${err.message} baseURL=${settings.baseURL}`)
      })
    }
    req.signal?.addEventListener('abort', stopServer, { once: true })
    controller.signal.addEventListener('abort', stopServer, { once: true })
    try {
      const res = await fetchReadable(
        `${settings.baseURL}/tts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: req.signal ? AbortSignal.any([controller.signal, req.signal]) : controller.signal,
        },
        settings.baseURL,
      )
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`TTS error ${res.status}: ${errText.slice(0, 500)}`)
      }
      const buffer = wrapPcmAsWav(Buffer.from(await res.arrayBuffer()))
      return {
        audioBase64: buffer.toString('base64'),
        mimeType: 'audio/wav',
      }
    } finally {
      req.signal?.removeEventListener('abort', stopServer)
      controller.signal.removeEventListener('abort', stopServer)
      clearTimeout(timer)
    }
  }

  private resolveSettings(req: TTSGenerateRequest): ResolvedGenieSettings {
    const cfg = req.globalConfig
    if (!cfg.enabled) throw new Error('TTS is disabled')

    const card = req.card
    const cardVoice = card ? readRoleVoiceConfig(card) : null

    const merged: Record<string, unknown> = {
      baseURL: cfg.baseURL,
      characterName: cfg.characterName,
      onnxModelDir: cfg.onnxModelDir,
      referenceAudio: cfg.referenceAudioRelPath,
      referenceText: cfg.referenceText,
      referenceLanguage: cfg.referenceLanguage,
      outputLanguage: cfg.outputLanguage,
    }
    if (cardVoice) {
      for (const key of ['baseURL', 'characterName', 'onnxModelDir', 'referenceAudio', 'referenceText', 'referenceLanguage', 'outputLanguage']) {
        if (cardVoice[key] !== undefined && cardVoice[key] !== null && cardVoice[key] !== '') {
          merged[key] = cardVoice[key]
        }
      }
      if (!cardVoice.referenceText) merged.referenceText = ''
    }
    if (req.overrides) {
      if (req.overrides.baseURL) merged.baseURL = req.overrides.baseURL
      if (req.overrides.characterName) merged.characterName = req.overrides.characterName
      if (req.overrides.onnxModelDir) merged.onnxModelDir = req.overrides.onnxModelDir
      if (req.overrides.referenceAudioRelPath) merged.referenceAudio = req.overrides.referenceAudioRelPath
      if (req.overrides.referenceText) merged.referenceText = req.overrides.referenceText
      if (req.overrides.referenceLanguage) merged.referenceLanguage = req.overrides.referenceLanguage
      if (req.overrides.outputLanguage) merged.outputLanguage = req.overrides.outputLanguage
    }

    const baseURL = applyTtsPortShift(normalizeBaseURL(String(merged.baseURL || '')))
    if (!baseURL) throw new Error('TTS baseURL is not configured')
    assertLocalBaseURL(baseURL)

    const characterName = String(merged.characterName || '').trim()
    if (!characterName) throw new Error('Genie characterName is not configured')

    const onnxRel = String(merged.onnxModelDir || '')
    const refRel = String(merged.referenceAudio || '')
    if (!onnxRel) throw new Error('ONNX model directory is not configured')
    if (!refRel) throw new Error('Reference audio is not configured')

    const onnxAbs = card ? resolveRoleVoiceFile(card, onnxRel) : resolveVoicePath(onnxRel)
    const refAbs = card ? resolveRoleVoiceFile(card, refRel) : resolveVoicePath(refRel)

    if (!fs.existsSync(onnxAbs)) throw new Error(`ONNX model directory not found: ${onnxAbs}`)
    if (!fs.existsSync(refAbs)) throw new Error(`Reference audio not found: ${refAbs}`)

    const referenceText = String(merged.referenceText || '')
    if (!referenceText) {
      throw new Error(
        'Genie 需要参考音频的准确转写：请在角色卡 voice 配置里补 referenceText' +
          '（Genie 不支持无参考文本模式，也不能使用全局配置的参考文本）',
      )
    }

    const langRaw = String(merged.referenceLanguage || 'zh')
    const referenceLanguage = GENIE_LANG_MAP[langRaw] ?? 'zh'
    const outputRaw = String(merged.outputLanguage || 'auto')
    const outputLanguage = outputRaw === 'auto'
      ? card?.language
        ? GENIE_LANG_MAP[roleSpeechLanguage(card.language)] ?? referenceLanguage
        : referenceLanguage
      : GENIE_LANG_MAP[outputRaw] ?? referenceLanguage
    if (card?.language) {
      const spoken = roleSpeechLanguage(card.language)
      if ((spoken === 'yue' ? 'zh' : spoken) !== outputLanguage) {
        throw new Error(`角色说话语言 ${card.language} 与 Genie 目标合成语言 ${outputRaw} 不一致，请调整 outputLanguage`)
      }
    }

    return { baseURL, characterName, onnxModelAbs: onnxAbs, refAudioAbs: refAbs, referenceText, referenceLanguage, outputLanguage }
  }

  private async ensureCharacterLoaded(settings: ResolvedGenieSettings, signal?: AbortSignal): Promise<void> {
    let loaded = this.loadedCharacters.get(settings.baseURL)
    if (!loaded) {
      loaded = new Set()
      this.loadedCharacters.set(settings.baseURL, loaded)
    }
    if (loaded.has(settings.characterName)) return

    const setupSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000)

    const loadBody = {
      character_name: settings.characterName,
      onnx_model_dir: settings.onnxModelAbs,
      language: settings.outputLanguage,
    }
    const loadRes = await fetchReadable(
      `${settings.baseURL}/load_character`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loadBody), signal: setupSignal },
      settings.baseURL,
    )
    if (!loadRes.ok) {
      throw new Error(`load_character failed (${loadRes.status}): ${await loadRes.text()}`)
    }

    const refBody = {
      character_name: settings.characterName,
      audio_path: settings.refAudioAbs,
      audio_text: settings.referenceText,
      language: settings.referenceLanguage,
    }
    const refRes = await fetchReadable(
      `${settings.baseURL}/set_reference_audio`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(refBody), signal: setupSignal },
      settings.baseURL,
    )
    if (!refRes.ok) {
      throw new Error(`set_reference_audio failed (${refRes.status}): ${await refRes.text()}`)
    }

    loaded.add(settings.characterName)
  }
}

function normalizeBaseURL(url: string): string {
  return (url || '').replace(/\/+$/, '')
}

async function fetchReadable(
  input: string,
  init: RequestInit,
  _baseURL: string,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
    if (e.name === 'AbortError') throw err
    const code = e.cause?.code
    if (code === 'ECONNREFUSED') {
      throw new Error('无法连接 Genie-TTS 服务，请确认服务已启动且端口一致')
    }
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new Error('连接 Genie-TTS 服务超时，请检查网络')
    }
    if (code === 'ENOTFOUND') {
      throw new Error('Genie-TTS 地址无法解析，请检查网络')
    }
    throw new Error(`请求 Genie-TTS 失败: ${code ?? e.message ?? 'unknown'}`)
  }
}
