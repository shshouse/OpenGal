/**
 * GPT-SoVITS TTS 适配器。
 *
 * 协议：GPT-SoVITS api_v2.py
 * - GET /set_gpt_weights?weights_path=... 切换 GPT .ckpt
 * - GET /set_sovits_weights?weights_path=... 切换 SoVITS .pth
 * - POST /tts 合成（body 含 ref_audio_path / prompt_text / text 等）
 *
 * 与原 ttsClient.ts 的差异：
 * - 增加角色卡感知：当请求附带 RoleCardEntry 时，从角色目录解析 weights / 参考音频
 * - 角色卡 voice.configRef 指向的 JSON 与全局 TTSConfig 合并（角色级覆盖全局）
 */

import fs from 'node:fs'
import type { RoleCardEntry, TTSConfig } from '@shared/types'
import { resolveVoicePath } from '../paths'
import { readRoleVoiceConfig, resolveRoleVoiceFile } from '../roleCardLoader'
import type {
  TTSAdapter,
  TTSGenerateRequest,
  TTSGenerateResponse,
} from './types'

interface ResolvedTTSSettings {
  baseURL: string
  gptModelAbs: string
  sovitsModelAbs: string
  refAudioAbs: string
  referenceText: string
  referenceLanguage: string
  outputLanguage: string
  speedFactor: number
  textSplitMethod: string
}

export class GptSovitsAdapter implements TTSAdapter {
  readonly provider = 'gpt-sovits'

  /**
   * Map<baseURL, {gpt, sovits}>：记录每个 server 上当前加载的权重，避免重复 set。
   */
  private appliedWeights = new Map<string, { gpt?: string; sovits?: string }>()

  reset(): void {
    this.appliedWeights.clear()
  }

  async ping(req: { globalConfig: TTSConfig }): Promise<{ ok: boolean; message?: string }> {
    const cfg = req.globalConfig
    if (!cfg.enabled) return { ok: false, message: 'TTS 未启用' }
    const base = normalizeBaseURL(cfg.baseURL)
    if (!base) return { ok: false, message: 'TTS baseURL is not configured' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3_000)
    try {
      const res = await fetchReadable(
        `${base}/control?command=ping`,
        { signal: controller.signal },
        base,
      )
      return { ok: true, message: `GPT-SoVITS API OK (HTTP ${res.status})` }
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
    await this.applyWeightsIfNeeded(settings)

    const body = {
      text,
      text_lang: settings.outputLanguage || 'auto',
      ref_audio_path: settings.refAudioAbs,
      prompt_text: settings.referenceText,
      prompt_lang: settings.referenceLanguage || 'zh',
      top_k: 5,
      top_p: 1,
      temperature: 1,
      text_split_method: settings.textSplitMethod || 'cut5',
      batch_size: 1,
      speed_factor: settings.speedFactor ?? 1,
      streaming_mode: false,
      media_type: 'wav',
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

  /**
   * 合成请求里的 TTSConfig 优先级（从高到低）：
   * 1. request.overrides
   * 2. 角色卡 voice.configRef 指向的 JSON（如 voice/gpt-sovits/config.json）
   * 3. AppConfig.tts（globalConfig）
   *
   * 角色卡 voice 配置里的相对路径会用 resolveRoleVoiceFile 解析（相对角色目录）。
   * 缺角色卡时回退到 resolveVoicePath（全局 voice 根目录）。
   */
  private resolveSettings(req: TTSGenerateRequest): ResolvedTTSSettings {
    const cfg = req.globalConfig
    if (!cfg.enabled) throw new Error('TTS is disabled')

    const card = req.card
    const cardVoice = card ? readRoleVoiceConfig(card) : null

    // 合并：global → card voice → request overrides
    const merged: Record<string, unknown> = {
      baseURL: cfg.baseURL,
      gptModel: cfg.gptModelRelPath,
      sovitsModel: cfg.sovitsModelRelPath,
      referenceAudio: cfg.referenceAudioRelPath,
      referenceText: cfg.referenceText,
      referenceLanguage: cfg.referenceLanguage,
      outputLanguage: cfg.outputLanguage,
      speedFactor: cfg.speedFactor,
      textSplitMethod: cfg.textSplitMethod,
    }
    if (cardVoice) {
      for (const key of [
        'baseURL',
        'gptModel',
        'sovitsModel',
        'referenceAudio',
        'referenceText',
        'referenceLanguage',
        'outputLanguage',
        'speedFactor',
        'textSplitMethod',
      ]) {
        if (cardVoice[key] !== undefined && cardVoice[key] !== null && cardVoice[key] !== '') {
          merged[key] = cardVoice[key]
        }
      }
    }
    if (req.overrides) {
      if (req.overrides.baseURL) merged.baseURL = req.overrides.baseURL
      if (req.overrides.gptModelRelPath) merged.gptModel = req.overrides.gptModelRelPath
      if (req.overrides.sovitsModelRelPath) merged.sovitsModel = req.overrides.sovitsModelRelPath
      if (req.overrides.referenceAudioRelPath) {
        merged.referenceAudio = req.overrides.referenceAudioRelPath
      }
      if (req.overrides.referenceText) merged.referenceText = req.overrides.referenceText
      if (req.overrides.referenceLanguage) merged.referenceLanguage = req.overrides.referenceLanguage
      if (req.overrides.outputLanguage) merged.outputLanguage = req.overrides.outputLanguage
      if (req.overrides.speedFactor !== undefined) merged.speedFactor = req.overrides.speedFactor
      if (req.overrides.textSplitMethod) merged.textSplitMethod = req.overrides.textSplitMethod
    }

    const baseURL = normalizeBaseURL(String(merged.baseURL || ''))
    if (!baseURL) throw new Error('TTS baseURL is not configured')

    const gptRel = String(merged.gptModel || '')
    const sovitsRel = String(merged.sovitsModel || '')
    const refRel = String(merged.referenceAudio || '')
    if (!gptRel) throw new Error('GPT model path is not configured')
    if (!sovitsRel) throw new Error('SoVITS model path is not configured')
    if (!refRel) throw new Error('Reference audio is not configured')

    const gptAbs = card ? resolveRoleVoiceFile(card, gptRel) : resolveVoicePath(gptRel)
    const sovitsAbs = card ? resolveRoleVoiceFile(card, sovitsRel) : resolveVoicePath(sovitsRel)
    const refAbs = card ? resolveRoleVoiceFile(card, refRel) : resolveVoicePath(refRel)

    if (!fs.existsSync(gptAbs)) throw new Error(`GPT weights not found: ${gptAbs}`)
    if (!fs.existsSync(sovitsAbs)) throw new Error(`SoVITS weights not found: ${sovitsAbs}`)
    if (!fs.existsSync(refAbs)) throw new Error(`Reference audio not found: ${refAbs}`)

    const referenceText = String(merged.referenceText || '')
    if (!referenceText) throw new Error('Reference text is not configured')

    return {
      baseURL,
      gptModelAbs: gptAbs,
      sovitsModelAbs: sovitsAbs,
      refAudioAbs: refAbs,
      referenceText,
      referenceLanguage: String(merged.referenceLanguage || 'zh'),
      outputLanguage: String(merged.outputLanguage || 'auto'),
      speedFactor: typeof merged.speedFactor === 'number' ? (merged.speedFactor as number) : 1,
      textSplitMethod: String(merged.textSplitMethod || 'cut5'),
    }
  }

  private async applyWeightsIfNeeded(settings: ResolvedTTSSettings): Promise<void> {
    const current = this.appliedWeights.get(settings.baseURL) ?? {}
    if (current.gpt !== settings.gptModelAbs) {
      const url = `${settings.baseURL}/set_gpt_weights?weights_path=${encodeURIComponent(settings.gptModelAbs)}`
      const res = await fetchReadable(url, { method: 'GET' }, settings.baseURL)
      if (!res.ok) {
        throw new Error(`set_gpt_weights failed (${res.status}): ${await res.text()}`)
      }
      current.gpt = settings.gptModelAbs
    }
    if (current.sovits !== settings.sovitsModelAbs) {
      const url = `${settings.baseURL}/set_sovits_weights?weights_path=${encodeURIComponent(settings.sovitsModelAbs)}`
      const res = await fetchReadable(url, { method: 'GET' }, settings.baseURL)
      if (!res.ok) {
        throw new Error(`set_sovits_weights failed (${res.status}): ${await res.text()}`)
      }
      current.sovits = settings.sovitsModelAbs
    }
    this.appliedWeights.set(settings.baseURL, current)
  }
}

function normalizeBaseURL(url: string): string {
  return (url || '').replace(/\/+$/, '')
}

/**
 * 包装 fetch：当连接失败时，把 Node 隐藏在 `cause` 里的底层错误码（ECONNREFUSED /
 * ETIMEDOUT / ENOTFOUND 等）抽到 message 顶层，并附上 baseURL，方便排错。
 *
 * Node fetch 在连接被拒/超时/DNS 失败时只会抛出 `TypeError: fetch failed`，
 * 真正的原因藏在 `error.cause.code`，外层日志看不到，常被误判为"代码 bug"。
 */
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
        `无法连接 GPT-SoVITS 服务（${baseURL}）：连接被拒绝。请到「设置 → TTS → 启动服务」启动后端，或确认 baseURL 端口与服务一致。`,
      )
    }
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new Error(
        `连接 GPT-SoVITS 服务超时（${baseURL}）：服务可能未就绪或网络不通。`,
      )
    }
    if (code === 'ENOTFOUND') {
      throw new Error(
        `无法解析 GPT-SoVITS 主机（${baseURL}）：DNS 查询失败，请检查 baseURL。`,
      )
    }
    throw new Error(
      `请求 GPT-SoVITS 失败（${baseURL}）：${code ?? e.message ?? 'unknown'}${causeMsg ? ' - ' + causeMsg : ''}`,
    )
  }
}
