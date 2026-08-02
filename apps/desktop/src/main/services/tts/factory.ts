/**
 * TTS 适配器工厂。按 provider 选具体适配器，缺省走 gpt-sovits。
 * M2 阶段只内置 gpt-sovits，后续 M4 插件 SDK 完成后改为运行时注册。
 */

import type { TTSAdapter } from './types'
import { GptSovitsAdapter } from './gptSovitsAdapter'

const gptSovitsAdapter = new GptSovitsAdapter()
const adapters = new Map<string, TTSAdapter>([
  [gptSovitsAdapter.provider, gptSovitsAdapter],
])

export function chooseTTSAdapter(provider?: string): TTSAdapter {
  return adapters.get(provider ?? '') ?? gptSovitsAdapter
}

export function resetAllTTSAdapters(): void {
  for (const adapter of adapters.values()) adapter.reset()
}
