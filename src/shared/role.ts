import type { LLMConfig, Live2DModelConfig } from './config'

export type EmotionTag =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'shy'
  | 'proud'
  | 'thinking'
  | 'sleepy'
  | 'relaxed'
  | 'excited'
  | 'worried'

export type WindowMode = 'mate' | 'theater'

export type PerformanceMode = 'live2d' | 'sprite' | 'auto'

export interface RoleLive2DConfig {
  modelPath: string
  canvasYRatio?: number
  scale?: number
  xRatio?: number
  paramMapping?: Live2DModelConfig['paramMapping']
}

export interface RoleSpriteConfig {
  spriteDir: string
  defaultSprite: string
  scale?: number
}

export interface SpriteFrames {
  idle: string
  blink?: string
  talk?: string
  blinkTalk?: string
  happy?: string
  sad?: string
}

export interface RoleVoiceConfig {
  // 声明模型格式（gpt-sovits / genie），不等于引擎开关；引擎由全局 TTS 设置决定，不匹配时该角色无语音
  engine?: string
  configRef?: string
}

export interface RoleASRConfig {
  enabled?: boolean
  language?: 'zh' | 'ja' | 'en'
}

export interface RolePerformanceConfig {
  mode: PerformanceMode
  preferred?: ('live2d' | 'sprite')[]
  live2d?: RoleLive2DConfig
  sprite?: RoleSpriteConfig
}

export interface RolePersona {
  userIdentity?: string
  userTerm?: string
  description: string
  personality: string
  scenario?: string
  rules?: string
}

export interface RoleCard {
  id: string
  name: string
  displayName?: string
  color?: string
  language?: string
  windowMode: WindowMode
  performance: RolePerformanceConfig
  voice?: RoleVoiceConfig
  asr?: RoleASRConfig
  llm?: Partial<LLMConfig>
  persona: RolePersona
}

export interface RoleCardEntry extends RoleCard {
  rootPath: string
  folderName: string
  builtin?: boolean
  spriteFrames?: SpriteFrames
}
