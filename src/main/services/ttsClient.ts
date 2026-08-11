/**
 * TTS 客户端 facade：把 IPC 层抽象的 TTSSpeakRequest 路由到具体适配器。
 *
 * 与改造前相比，把"GPT-SoVITS only"的硬编码搬到 GptSovitsAdapter，
 * 让上层（IPC / pipeline）不再耦合具体引擎。
 *
 * 角色卡感知：
 * - 上层可以传入 `roleCardId`，由 facade 通过 roleCardLoader 拉出 RoleCardEntry
 * - 适配器由 RoleCard.voice.provider 决定（缺省 gpt-sovits）
 */

import type { TTSConfig } from '@shared/types'
import { readConfig } from './configStore'
import { getRoleCard } from './roleCardLoader'
import { chooseTTSAdapter, resetAllTTSAdapters } from './tts/factory'
import { logBus } from './logBus'

export interface TTSSpeakRequest {
  text: string
  /** 显式角色 ID；不传则用 AppConfig.activeCharacterId */
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
