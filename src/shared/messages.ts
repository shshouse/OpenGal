export interface UserInputMessage {
  text: string
  source?: 'user' | 'option' | 'voice' | 'plugin' | 'live' | 'system'
  // 仅注入 LLM 上下文、不落聊天历史的系统提示（如唤醒问候）
  systemPrompt?: string
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
