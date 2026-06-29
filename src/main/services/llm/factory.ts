/**
 * LLM 适配器工厂。按 `LLMConfig.provider` 选具体适配器，缺省走 OpenAI 兼容。
 *
 * 对齐 RachelForster 的 `LLMAdapterFactory` 但更轻量：当前只内置两个适配器，
 * 后续 M4 插件 SDK 完成后会改为运行时注册。
 */

import type { LLMConfig } from '@shared/types'
import type { LLMAdapter } from './types'
import { OpenAIAdapter } from './openaiAdapter'
import { AnthropicAdapter } from './anthropicAdapter'

const openaiAdapter = new OpenAIAdapter()
const anthropicAdapter = new AnthropicAdapter()

export function chooseAdapter(config: LLMConfig): LLMAdapter {
  switch (config.provider) {
    case 'anthropic':
      return anthropicAdapter
    case 'openai':
    case undefined:
    default:
      return openaiAdapter
  }
}
