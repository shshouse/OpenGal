/**
 * Shared types between main, preload, and renderer.
 * Keep this file free of runtime imports so it can be consumed by all layers.
 */

export type LLMProvider = 'openai' | 'anthropic'

export interface LLMConfig {
  /** LLM 协议标识。'openai' 覆盖所有 OpenAI 兼容端点（OpenAI / OpenRouter / DeepSeek / Gemini OAI 桥 / 通义 / 豆包等）。 */
  provider?: LLMProvider
  baseURL: string
  apiKey: string
  modelName: string
  temperature?: number
  maxTokens?: number
  /** 是否启用思考模式（DeepSeek thinking / 推理模型）。缺省时按模型名自动判断。 */
  thinking?: boolean
  /** 思考强度：思考 token 预算（DeepSeek budget_tokens）。缺省 1024。 */
  thinkingBudget?: number
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
  /** GPT-SoVITS API server URL, e.g. http://127.0.0.1:9880 */
  baseURL: string
  /** Relative path to GPT .ckpt weight file (relative to voice dir) */
  gptModelRelPath: string
  /** Relative path to SoVITS .pth weight file (relative to voice dir) */
  sovitsModelRelPath: string
  /** Relative path to reference audio (relative to voice dir) */
  referenceAudioRelPath: string
  /** Transcript of the reference audio */
  referenceText: string
  /** Language of the reference audio */
  referenceLanguage: TTSLanguage
  /** Target output language */
  outputLanguage: TTSLanguage
  /** Playback speed factor */
  speedFactor: number
  /** Text splitting method */
  textSplitMethod: string
}

export interface ASRConfig {
  enabled: boolean
  modelPath: string
  language: 'zh' | 'en' | 'ja'
  sampleRate: number
  autoSend: boolean
}

export interface AppConfig {
  uiLanguage: 'zh' | 'en' | 'ja'
  theme: 'light' | 'dark' | 'system'
  llm: LLMConfig
  tts: TTSConfig
  asr: ASRConfig
  model: Live2DModelConfig | null
  activeCharacterId: string | null
  showLive2D: boolean
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
  /** assistant 消息携带的工具调用请求 */
  tool_calls?: ToolCall[]
  /** tool 角色消息对应的 tool_call id */
  tool_call_id?: string
  /** tool 角色消息的可读名称 */
  name?: string
}

export interface LLMRequest {
  messages: ChatMessage[]
  overrides?: Partial<LLMConfig>
  /** 工具定义列表（OpenAI function calling 格式） */
  tools?: ToolDefinition[]
  /** 强制 LLM 必须使用工具：'auto' | 'none' | { type: 'function', function: { name } } */
  toolChoice?: unknown
}

export interface LLMResponse {
  content: string
  /** LLM 请求的工具调用（一次响应可能多个；非流式才会一次性返回） */
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
  /** TTS 引擎标识，如 'gpt-sovits' / 'edge-tts' / 'cosyvoice'。M2 阶段仅支持 'gpt-sovits' */
  provider: string
  /** 相对角色目录的 voice 配置文件路径（如 voice/gpt-sovits/config.json） */
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
  /** 角色级 LLM 覆盖（可选）。未设字段沿用 AppConfig.llm */
  llm?: Partial<LLMConfig>
  persona: RolePersona
}

/**
 * 角色卡运行期视图：在原始 RoleCard 之上附加加载时解析出的元信息。
 * Main 进程扫描 mod/role-card 下的 character.json 后产出，前端通过 IPC 拉取。
 */
export interface RoleCardEntry extends RoleCard {
  /** 角色卡所在目录的绝对路径（main 端用，用于解析相对路径） */
  rootPath: string
  /** 角色卡所在目录在 mod/role-card 下的目录名（用作回退 id） */
  folderName: string
  /** 是否随包内置（来自 mod/，用户不应删除） */
  builtin?: boolean
}

export interface LLMDialogueItem {
  text: string
  emotion?: EmotionTag | string
  action?: string
  [key: string]: unknown
}

/**
 * OpenAI 兼容协议的工具定义（function calling / tool use）。
 * Anthropic 适配器在内部映射为 tools 字段。
 */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>  // JSON Schema
  }
}

/** LLM 在某次响应中请求的工具调用 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string  // JSON 字符串
  }
}
