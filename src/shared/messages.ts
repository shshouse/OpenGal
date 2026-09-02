export interface UserInputMessage {
  text: string
  source?: 'user' | 'option' | 'voice' | 'plugin' | 'live'
}

export interface LLMDialogMessage {
  name: string
  text: string
  assetId?: string | number
  emotion?: string
  motion?: string
  effect?: string
  translate?: string
}

export interface TTSOutputMessage {
  audioUrl: string
  name: string
  text: string
  assetId?: string | number
  emotion?: string
  motion?: string
  effect?: string
  isSystem?: boolean
  isFinalSegment?: boolean
  minDisplaySeconds?: number
}

export interface ReasoningMessage {
  delta: string
  accumulated: string
}

export interface LLMTurnDoneMessage {
  ok: boolean
  error?: string
}

export interface LLMUsageMessage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}
