import type { TTSConfig } from '@shared/types'
import { readConfig } from './configStore'
import { getRoleCard } from './roleCardLoader'
import { chooseTTSAdapter, resetAllTTSAdapters } from './tts/factory'
import { logBus } from './logBus'

export interface TTSSpeakRequest {
  text: string
  roleCardId?: string
  overrides?: Partial<TTSConfig>
}

export interface TTSSpeakResponse {
  audioBase64: string
  mimeType: string
}

function resolveActiveCard(explicitId: string | undefined) {
  const cfg = readConfig()
  const id = explicitId || cfg.activeCharacterId
  if (!id) return null
  return getRoleCard(id)
}

export async function pingTTS(): Promise<{ ok: boolean; message?: string }> {
  const config = readConfig().tts
  const card = resolveActiveCard(undefined)
  const provider = card?.voice?.provider || config.provider
  const adapter = chooseTTSAdapter(provider)
  const res = await adapter.ping({ globalConfig: config })
  if (res.ok) {
    logBus.info('tts', `ping 成功 provider=${provider}`)
  } else {
    logBus.warn('tts', `ping 失败: ${res.message ?? ''}`)
  }
  return res
}

export function resetTTSState(): void {
  resetAllTTSAdapters()
  logBus.info('tts', '已重置所有 TTS 适配器状态')
}

const WARMUP_TEXT: Record<string, string> = { zh: '你好', ja: 'こんにちは', en: 'Hello', ko: '안녕하세요' }

// Genie 冷启动首句要背上模型加载(~7s)+首次推理(~3s)，服务就绪/切角色时用短句烧掉
export async function warmupTTS(): Promise<boolean> {
  const config = readConfig().tts
  if (!config.enabled) return false
  const card = resolveActiveCard(undefined)
  const provider = card?.voice?.provider || config.provider
  if (provider !== 'genie') return false
  const adapter = chooseTTSAdapter(provider)
  const lang = config.referenceLanguage ?? 'zh'
  try {
    await adapter.generateSpeech({
      text: WARMUP_TEXT[lang] ?? WARMUP_TEXT.zh,
      globalConfig: config,
      card,
    })
    logBus.info('tts', `Genie 预热完成，首句延迟已消除 provider=${provider}`)
    return true
  } catch (err) {
    logBus.warn('tts', `Genie 预热失败（不影响后续使用）: ${(err as Error).message}`)
    return false
  }
}

export async function speak(request: TTSSpeakRequest): Promise<TTSSpeakResponse> {
  const config = readConfig().tts
  const card = resolveActiveCard(request.roleCardId)
  const provider = card?.voice?.provider || config.provider
  const adapter = chooseTTSAdapter(provider)
  const preview = request.text.slice(0, 80) + (request.text.length > 80 ? '...' : '')
  logBus.info('tts', `合成开始 provider=${provider} 文本=${preview}`)
  try {
    const res = await adapter.generateSpeech({
      text: request.text,
      globalConfig: config,
      card,
      overrides: request.overrides,
    })
    logBus.info('tts', `合成完成 长度=${res.audioBase64.length}B64 type=${res.mimeType}`)
    return res
  } catch (err) {
    logBus.error('tts', `合成失败: ${(err as Error).message}`, (err as Error).stack)
    throw err
  }
}
