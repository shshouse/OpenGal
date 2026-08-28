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
