import type { LLMConfig, LLMPreset } from './types'

// 槽位解析：main 直通全局模型；sub 命中副手 preset，未配置或 id 失效时回退主模型
export function resolveSlotConfig(
  base: LLMConfig,
  presets: LLMPreset[] | undefined,
  subPresetId: string | undefined,
  slot: 'main' | 'sub' = 'main',
): { config: LLMConfig; isFallback: boolean } {
  if (slot !== 'sub') return { config: base, isFallback: true }
  const preset = subPresetId ? presets?.find((p) => p.id === subPresetId) : undefined
  return preset ? { config: preset, isFallback: false } : { config: base, isFallback: true }
}
