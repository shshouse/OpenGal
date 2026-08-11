/**
 * TTS 适配器工厂。按 provider 选具体适配器，缺省走 gpt-sovits。
 */

import type { TTSAdapter } from './types'
import { GptSovitsAdapter } from './gptSovitsAdapter'
import { GenieAdapter } from './genieAdapter'

const gptSovitsAdapter = new GptSovitsAdapter()
const genieAdapter = new GenieAdapter()
const adapters = new Map<string, TTSAdapter>([
  [gptSovitsAdapter.provider, gptSovitsAdapter],
  [genieAdapter.provider, genieAdapter],
])

export function chooseTTSAdapter(provider?: string): TTSAdapter {
  return adapters.get(provider ?? '') ?? gptSovitsAdapter
}

export function resetAllTTSAdapters(): void {
  for (const adapter of adapters.values()) adapter.reset()
}
