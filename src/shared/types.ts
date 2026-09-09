export type LLMProvider = 'openai'

export interface LLMConfig {
  provider?: LLMProvider
  baseURL: string
  apiKey: string
  modelName: string
  temperature?: number
  maxTokens?: number
  contextWindow?: number
  multimodal?: boolean
  thinking?: boolean
  thinkingBudget?: number
}

export interface LLMPreset extends LLMConfig {
  id: string
  label: string
}

export interface Live2DModelConfig {
  modelPath: string
  modelUrl: string
  folderPath: string
  modelJsonFile: string
  canvasYRatio: number
  scale: number
  xRatio: number
  paramMapping: {
    angleX: string | null
    angleY: string | null
    angleZ: string | null
    bodyAngleX: string | null
    eyeBallX: string | null
    eyeBallY: string | null
    mouthOpenY?: string | null
    mouthForm?: string | null
  }
}

export interface CharacterCard {
  id: string
  name: string
  userIdentity: string
  userTerm: string
  description: string
  personality: string
  scenario: string
  rules: string
  language: string
  builtin?: boolean
}

export type TTSLanguage =
  | 'auto'
  | 'auto_yue'
  | 'zh'
  | 'en'
  | 'ja'
  | 'yue'
  | 'ko'
  | 'all_zh'
  | 'all_ja'
  | 'all_yue'
  | 'all_ko'

export interface TTSConfig {
  enabled: boolean
  provider: 'gpt-sovits' | 'genie'
  baseURL: string
  gptModelRelPath: string
  sovitsModelRelPath: string
  characterName: string
  onnxModelDir: string
  referenceAudioRelPath: string
  referenceText: string
  referenceLanguage: TTSLanguage
  outputLanguage: TTSLanguage
  speedFactor: number
  textSplitMethod: string
}

export interface ASRConfig {
  enabled: boolean
  engine: 'sherpa'
  modelPath: string
  language: 'auto' | 'zh' | 'en' | 'ja' | 'ko' | 'yue'
  sampleRate: number
  autoSend: boolean
  deviceId: string
  hotwords: string[]
  vadSilenceMs: number
  directorEnabled: boolean
  directorScreenContext: boolean
  directorCooldownSec: number
}

export interface MarketMod {
  id: string
  mod_number: number
  title: string
  description: string | null
  cover_url: string | null
  images: string[] | null
  tags: string[] | null
  download_count: number
  like_count: number
  category?: { id: string; name: string; slug: string } | null
  author?: { id: string; username: string } | null
  versions?: Array<{ id: string; version: string; file_size: number | null }> | null
}

export interface MarketListResult {
  game: {
    id: string
    name: string
    game_number: string
    icon_url: string | null
    images: string[] | null
    description: string | null
  }
  categories: Array<{ id: string; name: string; slug: string }>
  mods: MarketMod[]
  totalMods: number
  page: number
  pageSize: number
}

export interface MarketDownloadProgress {
  modId: string
  title: string
  received: number
  total: number
  done: boolean
  error?: string
  filePath?: string
}

export interface AppConfig {
  uiLanguage: 'zh' | 'en' | 'ja'
  theme: 'light' | 'dark' | 'system'
  llm: LLMConfig
  llmPresets?: LLMPreset[]
  tts: TTSConfig
  asr: ASRConfig
  model: Live2DModelConfig | null
  activeCharacterId: string | null
  showLive2D: boolean
  memory: MemoryConfig
}

export interface MemoryConfig {
  factBudgetChars: number
  storyBudgetChars: number
  injectCharCap: number
  batchTurns: number
  idleMinutes: number
  fallbackHours: number
  windowBatchTurns: number
}

export interface MemoryFact {
  id: string
  text: string
  entity: 'user' | 'character' | 'relationship'
  importance: number
  confidence: number
  source: 'user_statement' | 'llm_inferred' | 'manual'
  created_at: string
  last_confirmed_at: string
  status: 'active' | 'archived'
  evidence: { reinforce: number; negate: number }
  protected?: boolean
}

export interface MemoryStory {
  id: string
  kind: 'event' | 'promise' | 'milestone' | 'joke'
  text: string
  occurred_at: string
  due_at: string | null
  fulfilled: boolean
  importance: number
  status: 'active' | 'archived'
  created_at: string
}

export interface MemoryCandidateFact {
  text: string
  entity: MemoryFact['entity']
  importance: number
  confidence: number
  reason: string
}

export interface MemoryCandidateStory {
  kind: MemoryStory['kind']
  text: string
  importance: number
  reason: string
  due_at?: string | null
}

export interface MemoryApplyPayload {
  facts: MemoryCandidateFact[]
  stories: MemoryCandidateStory[]
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'
export interface TextContentPart {
  type: 'text'
  text: string
}
export interface ImageContentPart {
  type: 'image_url'
  image_url: { url: string }
}
export type MessageContentPart = TextContentPart | ImageContentPart
export type MessageContent = string | MessageContentPart[]

export interface ChatMessage {
  role: ChatRole
  content: MessageContent
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface LLMRequest {
  messages: ChatMessage[]
  overrides?: Partial<LLMConfig>
  tools?: ToolDefinition[]
  toolChoice?: unknown
}

export interface LLMResponse {
  content: string
  toolCalls?: ToolCall[]
}

export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

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

export type WindowMode = 'pet' | 'theater'

export type PerformanceMode = 'live2d' | 'sprite' | 'auto'

export interface Live2DEmotionMapping {
  expression?: string
  motion?: string
  intensity?: number
}

export interface SpriteEmotionMapping {
  sprite: string
  scale?: number
  enter?: 'fade' | 'slide' | 'none'
}

export interface PerformanceManifest {
  default?: EmotionTag | string
  live2d?: Record<string, Live2DEmotionMapping>
  sprite?: Record<string, SpriteEmotionMapping>
}

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

export interface RoleVoiceConfig {
  provider: string
  configRef: string
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
}

export interface LLMDialogueItem {
  text: string
  emotion?: EmotionTag | string
  action?: string
  [key: string]: unknown
}
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface McpServerManifest {
  id: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  timeoutMs?: number
}

export interface WidgetManifest {
  id: string
  entry: string
  title: string
  placement: 'sidebar' | 'float'
}

export interface PluginManifest {
  formatVersion: number
  id: string
  name: string
  version: string
  author?: string
  description?: string
  permissions?: string[]
  contributions?: {
    widgets?: WidgetManifest[]
    mcpServers?: McpServerManifest[]
  }
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  enabled: boolean
  status: 'disabled' | 'enabled' | 'error'
  errorMessage?: string
  mcpTools: string[]
  widgetCount: number
}
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}
