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
  mode: 'offline' | 'streaming'
  modelPath: string
  language: 'auto' | 'zh' | 'en' | 'ja' | 'ko' | 'yue'
  sampleRate: number
  autoSend: boolean
  deviceId: string
  hotwords: string[]
  vadSilenceMs: number
  directorEnabled: boolean
  /** agent=围绕用户响应；life=自主观察与行动 */
  directorMode: 'agent' | 'life'
  directorScreenContext: boolean
  directorCooldownSec: number
  /** 允许导演在用户长时间不说话时主动开口 */
  directorInitiativeEnabled: boolean
  /** 每小时最多主动开口次数；<= 0 表示不限 */
  directorInitiativePerHour: number
  /** 用户静默多少分钟后才允许主动开口 */
  directorIdleMinutes: number
}

export interface MarketMod {
  id: string
  mod_number: number
  title: string
  description: string | null
  media: { thumbnail_url?: string | null; image_urls?: string[] | null } | null
  tags: string[] | null
  view_count: number
  download_count: number
  like_count: number
  latest_version: string | null
  latest_version_id: string | null
  source_info: { source_type?: 'original' | 'repost' } | null
  game?: { id: string; name: string; icon_url: string | null } | null
  category?: { id: string; name: string; slug: string } | null
  author?: { id: string; username: string; avatar_url: string | null } | null
  versions?: Array<{ id: string; version: string; file_size: number | null; status: string; created_at: string }> | null
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

export interface AppConfig {
  subtitles?: { mode: 'off' | 'translated' | 'bilingual'; targetLanguage: string }
  systemLocale?: string
  uiLanguage: 'zh' | 'en' | 'ja'
  theme: 'light' | 'dark' | 'system'
  llm: LLMConfig
  llmPresets?: LLMPreset[]
  // 副手模型（判断层）引用的 preset id；空/失效时回退 llm
  llmSubPresetId?: string
  tts: TTSConfig
  asr: ASRConfig
  model: Live2DModelConfig | null
  activeCharacterId: string | null
  showLive2D: boolean
  memory: MemoryConfig
  tools: ToolsConfig
  gameMode: GameModeConfig
  startup: StartupConfig
  screen: ScreenConfig
}

export interface ScreenConfig {
  /** 截图时排除桌宠自身窗口，避免角色不认识屏幕上的自己；关掉后 OBS 才能录到桌宠 */
  excludeSelf: boolean
}

export interface StartupConfig {
  greetingEnabled: boolean
}

export type BootStepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

export interface BootStep {
  id: 'live2d' | 'memory' | 'tts'
  label: string
  status: BootStepStatus
  detail?: string
}

export interface BootResult {
  steps: BootStep[]
  llmConfigured: boolean
}

export interface MemoryConfig {
  injectCharCap: number
  batchTurns: number
  idleMinutes: number
  fallbackHours: number
}

export interface ToolsConfig {
  webSearch: {
    provider: 'bing' | 'tavily'
    tavilyKey: string
  }
  fileSearchDirs: string[]
}

export interface GameModeConfig {
  enabled: boolean
  games: string[]
}

export interface EnvSnapshot {
  timeText: string
  idleSeconds: number
  justReturned: boolean
  awayMinutes: number
  game: { name: string; fullscreen: boolean } | null
  foreground: { app: string; title: string; fullscreen: boolean } | null
}

export interface MemoryFact {
  id: string
  text: string
  entity: 'user' | 'character' | 'relationship'
  // 主语 + 属性构成槽位：同一槽位的新值会替代旧值，而不是并列
  subject?: string | null
  attribute?: string | null
  object?: string | null
  // true=肯定陈述，false=否定陈述（“不喜欢咖啡”）
  polarity?: boolean
  importance: number
  confidence: number
  source: 'user_statement' | 'character_statement' | 'llm_inferred' | 'manual'
  created_at: string
  last_confirmed_at: string
  status: 'active' | 'superseded' | 'archived'
  valid_from?: string | null
  invalid_at?: string | null
  superseded_by?: string | null
  evidence: { reinforce: number; negate: number }
  protected?: boolean
  valid_until: string | null
  frozen_at: string | null
  embedding: number[] | null
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
  subject?: string | null
  attribute?: string | null
  object?: string | null
  polarity?: boolean
  // 这条信息是谁说的：决定它的可信级别，推断不能覆盖用户原话
  attributed_to?: 'user' | 'character' | 'inferred'
  importance: number
  confidence: number
  reason: string
  valid_until?: string | null
  frozen?: boolean
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
  // 这批候选来自哪段对话；写入时记录为来源证据，用于回查原话
  evidence?: { fromTs: number; toTs: number }
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
  // 持久化辅助字段：由主进程读取时附带，渲染层原样带回用于保序/保时间戳
  dbId?: number
  ts?: number
  // 上下文装配标记：摘要/环境/意图段有不同的保留优先级
  contextTag?: 'summary' | 'env' | 'intent'
}

export interface LLMRequest {
  messages: ChatMessage[]
  overrides?: Partial<LLMConfig>
  // main=表达层（台词）；sub=判断层（导演/记忆等），未配置副手时回退主模型
  slot?: 'main' | 'sub'
  tools?: ToolDefinition[]
  toolChoice?: unknown
}

export interface LLMUsage {
  promptTokens: number
  completionTokens?: number
  totalTokens?: number
}

export interface LLMResponse {
  content: string
  toolCalls?: ToolCall[]
  usage?: LLMUsage
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
