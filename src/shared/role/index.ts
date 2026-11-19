import type { LLMConfig, Live2DModelConfig } from '../app/config'
import type { RoleExampleTurn, RoleMode, RoleSummaryMeta } from '@core/role/types'

export type { RoleExampleTurn, RoleMode, RoleSummaryMeta }

export interface RoleDescribe {
  summary?: string
  tags?: string[]
}

export const STANDARD_EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'shy',
  'proud',
  'thinking',
  'sleepy',
  'relaxed',
  'excited',
  'worried',
] as const

export type EmotionTag = (typeof STANDARD_EMOTIONS)[number]

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
  /** sprites/emotions/<name>.png：文件名即表情名，不需要在卡片里声明 */
  emotions?: Record<string, string>
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

export type OutfitMode = 'sprite' | 'spine'

export interface RoleSpineConfig {
  skelPath: string
  atlasPath: string
  scale?: number
  xRatio?: number
  yRatio?: number
}

export interface RoleOutfit {
  id: string
  name: string
  mode: OutfitMode
  sprite?: RoleSpriteConfig
  spine?: RoleSpineConfig
}

export interface RoleOutfitEntry extends RoleOutfit {
  spriteFrames?: SpriteFrames
  spineSkelUrl?: string
  spineAtlasUrl?: string
}

/** 换装结果只在进程间传递，不落盘：选择本身由渲染层持久化 */
export interface RoleOutfitChange {
  roleId: string
  outfitId: string
}

export interface RolePerformanceConfig {
  mode: PerformanceMode
  preferred?: ('live2d' | 'sprite')[]
  live2d?: RoleLive2DConfig
  sprite?: RoleSpriteConfig
  outfits?: RoleOutfit[]
  defaultOutfit?: string
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
  mode?: RoleMode
  windowMode: WindowMode
  greeting?: string
  examples?: RoleExampleTurn[]
  describe?: RoleDescribe
  activeOutfitId?: string
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
  templateId?: string
  summary?: RoleSummaryMeta
  spriteFrames?: SpriteFrames
  outfitEntries?: RoleOutfitEntry[]
}

/** 玩家可改的角色卡字段；id、name、资源路径不开放编辑。 */
export interface RoleCardEditableFields {
  displayName?: string
  color?: string
  language?: string
  mode?: RoleMode
  greeting?: string
  examples?: RoleExampleTurn[]
  activeOutfitId?: string
  persona: RolePersona
}

export interface RoleCardSaveResult {
  card: RoleCard
  warnings: string[]
}
