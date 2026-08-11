/**
 * Genie-TTS 适配器。
 *
 * 协议：Genie-TTS FastAPI Server (src/genie_tts/Server.py)
 * - POST /load_character {character_name, onnx_model_dir, language}
 * - POST /set_reference_audio {character_name, audio_path, audio_text, language}
 * - POST /tts {character_name, text, split_sentence} -> StreamingResponse audio/wav
 *
 * 与 GptSovitsAdapter 的差异：
 * - 模型格式：ONNX 目录（非 .pth/.ckpt）
 * - 角色加载：一次性 load_character + set_reference_audio，后续 /tts 只传角色名
 * - 无 speed_factor / text_split_method，仅有 split_sentence 布尔
 */

import fs from 'node:fs'
import type { RoleCardEntry, TTSConfig } from '@shared/types'
import { resolveVoicePath } from '../paths'
import { readRoleVoiceConfig, resolveRoleVoiceFile } from '../roleCardLoader'
import type { TTSAdapter, TTSGenerateRequest, TTSGenerateResponse } from './types'

interface ResolvedGenieSettings {
  baseURL: string
  characterName: string
  onnxModelAbs: string
  refAudioAbs: string
  referenceText: string
  referenceLanguage: string
}

/** Genie language map: TTSLanguage -> Genie normalize_language input */
const GENIE_LANG_MAP: Record<string, string> = {
  zh: 'zh', en: 'en', ja: 'ja', ko: 'ko', yue: 'zh',
  auto: 'zh', auto_yue: 'zh',
  all_zh: 'zh', all_ja: 'ja', all_yue: 'zh', all_ko: 'ko',
}

export class GenieAdapter implements TTSAdapter {
  readonly provider = 'genie'

  /** Map<baseURL, Set<characterName>>：记录每个 server 上已加载+已设参考音频的角色 */
  private loadedCharacters = new Map<string, Set<string>>()

  reset(): void {
    this.loadedCharacters.clear()
  }

  async ping(req: { globalConfig: TTSConfig }): Promise<{ ok: boolean; message?: string }> {
    const cfg = req.globalConfig
    if (!cfg.enabled) return { ok: false, message: 'TTS 未启用' }
    const base = normalizeBaseURL(cfg.baseURL)
    if (!base) return { ok: false, message: 'TTS baseURL is not configured' }
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

  async generateSpeech(req: TTSGenerateRequest): Promise<TTSGenerateResponse> {
    const text = req.text.trim()
    if (!text) throw new Error('Empty TTS input')

    const settings = this.resolveSettings(req)
    await this.ensureCharacterLoaded(settings)

    const body = {
      character_name: settings.characterName,
      text,
      split_sentence: true,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120_000)
    try {
      const res = await fetchReadable(
        `${settings.baseURL}/tts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
        settings.baseURL,
      )
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`TTS error ${res.status}: ${errText.slice(0, 500)}`)
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      return {
        audioBase64: buffer.toString('base64'),
        mimeType: 'audio/wav',
      }
    } finally {
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
    }
    if (cardVoice) {
      for (const key of ['baseURL', 'characterName', 'onnxModelDir', 'referenceAudio', 'referenceText', 'referenceLanguage']) {
        if (cardVoice[key] !== undefined && cardVoice[key] !== null && cardVoice[key] !== '') {
          merged[key] = cardVoice[key]
        }
      }
    }
    if (req.overrides) {
      if (req.overrides.baseURL) merged.baseURL = req.overrides.baseURL
      if (req.overrides.characterName) merged.characterName = req.overrides.characterName
      if (req.overrides.onnxModelDir) merged.onnxModelDir = req.overrides.onnxModelDir
      if (req.overrides.referenceAudioRelPath) merged.referenceAudio = req.overrides.referenceAudioRelPath
      if (req.overrides.referenceText) merged.referenceText = req.overrides.referenceText
      if (req.overrides.referenceLanguage) merged.referenceLanguage = req.overrides.referenceLanguage
    }

    const baseURL = normalizeBaseURL(String(merged.baseURL || ''))
    if (!baseURL) throw new Error('TTS baseURL is not configured')

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
    if (!referenceText) throw new Error('Reference text is not configured')

    const langRaw = String(merged.referenceLanguage || 'zh')
    const referenceLanguage = GENIE_LANG_MAP[langRaw] ?? 'zh'

    return { baseURL, characterName, onnxModelAbs: onnxAbs, refAudioAbs: refAbs, referenceText, referenceLanguage }
  }

  private async ensureCharacterLoaded(settings: ResolvedGenieSettings): Promise<void> {
    let loaded = this.loadedCharacters.get(settings.baseURL)
    if (!loaded) {
      loaded = new Set()
      this.loadedCharacters.set(settings.baseURL, loaded)
    }
    if (loaded.has(settings.characterName)) return

    // 1. Load character
    const loadBody = {
      character_name: settings.characterName,
      onnx_model_dir: settings.onnxModelAbs,
      language: settings.referenceLanguage,
    }
    const loadRes = await fetchReadable(
      `${settings.baseURL}/load_character`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loadBody) },
      settings.baseURL,
    )
    if (!loadRes.ok) {
      throw new Error(`load_character failed (${loadRes.status}): ${await loadRes.text()}`)
    }

    // 2. Set reference audio
    const refBody = {
      character_name: settings.characterName,
      audio_path: settings.refAudioAbs,
      audio_text: settings.referenceText,
      language: settings.referenceLanguage,
    }
    const refRes = await fetchReadable(
      `${settings.baseURL}/set_reference_audio`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(refBody) },
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
  baseURL: string,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
    if (e.name === 'AbortError') throw err
    const code = e.cause?.code
    const causeMsg = e.cause?.message
    if (code === 'ECONNREFUSED') {
      throw new Error(
        `无法连接 Genie-TTS 服务（${baseURL}）：连接被拒绝。请确认 Genie 服务已启动且端口一致。`,
      )
    }
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new Error(`连接 Genie-TTS 服务超时（${baseURL}）：服务可能未就绪或网络不通。`)
    }
    if (code === 'ENOTFOUND') {
      throw new Error(`无法解析 Genie-TTS 主机（${baseURL}）：DNS 查询失败。`)
    }
    throw new Error(
      `请求 Genie-TTS 失败（${baseURL}）：${code ?? e.message ?? 'unknown'}${causeMsg ? ' - ' + causeMsg : ''}`,
    )
  }
}
