import type { LLMConfig } from '@shared/types'
import type { LLMAdapter } from './types'
import { OpenAIAdapter } from './openaiAdapter'

const openaiAdapter = new OpenAIAdapter()

export function chooseAdapter(_config: LLMConfig): LLMAdapter {
  return openaiAdapter
}
