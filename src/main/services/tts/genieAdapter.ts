import fs from 'node:fs'
import { roleSpeechLanguage, scriptLanguage, speechLanguageLabel, speechLanguageSupported } from '@shared/subtitles'
import type { RoleCardEntry, TTSConfig } from '@shared/types'
import { resolveVoicePath } from '../paths'
import { readRoleVoiceConfig, resolveRoleVoiceFile } from '../roleCardLoader'
import { applyTtsPortShift, assertLocalBaseURL } from '../ttsPort'
import { logBus } from '../logBus'
import type { TTSAdapter, TTSGenerateRequest, TTSGenerateResponse } from './types'
import { pickString } from './configValue'

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

const SYNTH_ATTEMPTS = 2
const PCM_SAMPLE_RATE = 32_000
const PCM_BYTES_PER_SAMPLE = 2

const wavDurationCache = new Map<string, number | null>()

/** 读 WAV 头算时长；参考音可能是 24k/44.1k、单/双声道，按 fmt 里的 byteRate 统一换算 */
export function wavDurationSeconds(file: string): number | null {
  if (wavDurationCache.has(file)) return wavDurationCache.get(file) ?? null
  let result: number | null = null
  try {
    const buf = fs.readFileSync(file)
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') {
      let offset = 12
      let byteRate = 0
      while (offset + 8 <= buf.length) {
        const id = buf.subarray(offset, offset + 4).toString('latin1')
        const size = buf.readUInt32LE(offset + 4)
        const body = offset + 8
        if (id === 'fmt ' && body + 12 <= buf.length) {
          byteRate = buf.readUInt32LE(body + 8)
        } else if (id === 'data' && byteRate > 0) {
          result = size / byteRate
          break
        }
        offset = body + size + (size % 2)
      }
    }
  } catch {
    result = null
  }
  wavDurationCache.set(file, result)
  return result
}

/** 粗略估算这句话该有多长，只用来识别“长得离谱”的输出 */
export function estimateSpeechSeconds(text: string): number {
  const compact = text.replace(/\s+/g, '')
  const perChar = scriptLanguage(text) === 'en' ? 0.085 : 0.16
  return Math.max(0.6, compact.length * perChar)
}

// 中文 G2P（g2pM）查不到这两个字的拼音会直接抛 IndexError，整段合成变空音频
const G2P_CHAR_FIXES: Record<string, string> = { 嗯: '恩', 呣: '母' }

export function sanitizeForG2P(text: string): string {
  return text.replace(/[嗯呣]/g, (ch) => G2P_CHAR_FIXES[ch] ?? ch)
}

/**
 * 判定合成结果是否可用。Genie 随机解码退化成两种形态：整段变回参考音（时长贴着参考音走），
 * 或文本前端异常导致空音频。两种都不能播出去。
 */
export function inspectSynthesis(
  pcm: Buffer,
  text: string,
  refSeconds: number | null,
): { bad: boolean; reason: string } {
  const duration = pcm.length / (PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE)
  if (duration < 0.2) return { bad: true, reason: `输出几乎为空（${duration.toFixed(2)}s）` }
  const expected = estimateSpeechSeconds(text)
  if (refSeconds && Math.abs(duration - refSeconds) <= 0.6 && duration > expected * 2.5) {
    return {
      bad: true,
      reason: `输出 ${duration.toFixed(2)}s 与参考音 ${refSeconds.toFixed(2)}s 接近，判定为复读参考音`,
    }
  }
  return { bad: false, reason: '' }
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
    const base = applyTtsPortShift(
      normalizeBaseURL(pickString(cardVoice ?? {}, 'baseURL') || cfg.baseURL),
    )
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

    // 中文音色模型走中文 G2P，先把会让它崩掉的字换掉；其他语种按原文送
    const spoken = settings.outputLanguage === 'zh' ? sanitizeForG2P(text) : text
    const body = {
      character_name: settings.characterName,
      text: spoken,
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
      const refSeconds = wavDurationSeconds(settings.refAudioAbs)
      let lastReason = ''
      // Genie 是随机解码的零样本模型：同一句台词会有小概率整段退化成复读参考音频，
      // 或直接吐空音频。重试一次基本能拿到正常结果，两次都不正常就放弃这段语音。
      for (let attempt = 1; attempt <= SYNTH_ATTEMPTS; attempt++) {
        req.signal?.throwIfAborted()
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
        const raw = Buffer.from(await res.arrayBuffer())
        const check = inspectSynthesis(raw, spoken, refSeconds)
        if (!check.bad) {
          return {
            audioBase64: wrapPcmAsWav(raw).toString('base64'),
            mimeType: 'audio/wav',
          }
        }
        lastReason = check.reason
        logBus.warn(
          'tts',
          `Genie 合成结果异常（第 ${attempt}/${SYNTH_ATTEMPTS} 次）：${check.reason}`,
          `文本=${text.slice(0, 60)}`,
        )
      }
      throw new Error(`语音合成结果异常：${lastReason}；已跳过本段语音`)
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

    const baseURL = applyTtsPortShift(normalizeBaseURL(pickString(merged, 'baseURL')))
    if (!baseURL) throw new Error('TTS baseURL is not configured')
    assertLocalBaseURL(baseURL)

    const characterName = pickString(merged, 'characterName').trim()
    if (!characterName) throw new Error('Genie characterName is not configured')

    const onnxRel = pickString(merged, 'onnxModelDir')
    const refRel = pickString(merged, 'referenceAudio')
    if (!onnxRel) throw new Error('ONNX model directory is not configured')
    if (!refRel) throw new Error('Reference audio is not configured')

    const onnxAbs = card ? resolveRoleVoiceFile(card, onnxRel) : resolveVoicePath(onnxRel)
    const refAbs = card ? resolveRoleVoiceFile(card, refRel) : resolveVoicePath(refRel)

    if (!fs.existsSync(onnxAbs)) throw new Error(`ONNX model directory not found: ${onnxAbs}`)
    if (!fs.existsSync(refAbs)) throw new Error(`Reference audio not found: ${refAbs}`)

    const referenceText = pickString(merged, 'referenceText')
    if (!referenceText) {
      throw new Error(
        'Genie 需要参考音频的准确转写：请在角色卡 voice 配置里补 referenceText' +
          '（Genie 不支持无参考文本模式，也不能使用全局配置的参考文本）',
      )
    }

    const langRaw = pickString(merged, 'referenceLanguage') || 'zh'
    const referenceLanguage = GENIE_LANG_MAP[langRaw] ?? 'zh'
    const outputRaw = pickString(merged, 'outputLanguage') || 'auto'
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
    if (!speechLanguageSupported(outputLanguage, req.text)) {
      throw new Error(
        `台词是${speechLanguageLabel(scriptLanguage(req.text)) ?? '其他语言'}，但当前音色模型只支持 ${outputLanguage}；` +
          'Genie 会把这段读成参考音频。请让角色用同语种说话，或换用该语种的音色模型。',
      )
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
