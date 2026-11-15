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
  /** 导演直接给出台词，跳过主管线再生成一次 */
  directorDirectSpeech: boolean
  directorScreenContext: boolean
  directorCooldownSec: number
  /** 允许导演在用户长时间不说话时主动开口 */
  directorInitiativeEnabled: boolean
  /** 每小时最多主动开口次数；<= 0 表示不限 */
  directorInitiativePerHour: number
  /** 用户静默多少分钟后才允许主动开口 */
  directorIdleMinutes: number
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

export interface MemoryConfig {
  injectCharCap: number
  batchTurns: number
  idleMinutes: number
  fallbackHours: number
}

export interface ToolsConfig {
  webSearch: {
    provider: 'local' | 'bing' | 'tavily'
    tavilyKey: string
  }
  fileSearchDirs: string[]
}

export interface GameModeConfig {
  enabled: boolean
  games: string[]
}

export interface ScreenConfig {
  /** 截图时排除相伴窗口自身，避免角色不认识屏幕上的自己；关掉后 OBS 才能录到相伴窗口 */
  excludeSelf: boolean
  /** 让角色能看到屏幕变没变，并自己决定要不要细看。关闭时不采集任何画面 */
  watch: boolean
}

export interface StartupConfig {
  greetingEnabled: boolean
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
  activeRoleId: string | null
  /** 每个角色独立的运行状态；未列出的角色默认沉睡 */
  runningRoles: Record<string, boolean>
  showLive2D: boolean
  memory: MemoryConfig
  tools: ToolsConfig
  gameMode: GameModeConfig
  startup: StartupConfig
  screen: ScreenConfig
}
