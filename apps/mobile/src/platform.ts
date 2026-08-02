/**
 * 移动端 PlatformAPI 实现。
 *
 * 和桌面端 Electron IPC 不同，移动端：
 * - config: 用 Capacitor Preferences 本地存储 (替代 electron-store)
 * - llm: 直接 fetch OpenAI 兼容端点 (BYOK) 或走 Cloudflare Worker 代理 (平台 key)
 * - tts/asr: 走云端 API (移动端无本地子进程)
 * - pet/window: 移动端不适用，返回 no-op
 * - character: 内置默认角色卡 (不依赖文件系统扫描)
 * - model: 内置 CDN Live2D 模型 (不依赖本地文件)
 * - rag/logs: 移动端暂不支持，返回空
 */

import { Preferences } from '@capacitor/preferences'
import type { PlatformAPI } from '@shared/platform'
import type {
  AppConfig,
  IpcResult,
  LLMRequest,
  LLMResponse,
  Live2DModelConfig,
  RoleCardEntry,
  ToolCall
} from '@shared/types'
import type { LogEntry, LogLevel } from '@shared/log'

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail<T>(error: string): IpcResult<T> {
  return { success: false, error }
}

function noop(): Promise<IpcResult<unknown>> {
  return Promise.resolve(ok(null))
}

function noopUnsub(): () => void {
  return () => {}
}

// --- 内置默认角色卡 ---

// 本地模型 URL（相对 public/ 目录，Vite dev/build 都会服务）
const NEURO_MODEL_URL = '/models/neuro/runtime/hiyori_free_t08.model3.json'

const BUILTIN_CHARACTERS: RoleCardEntry[] = [
  {
    id: 'ouka',
    name: 'ouka',
    displayName: 'Ouka',
    color: '#f9a8d4',
    language: 'zh',
    windowMode: 'pet',
    performance: {
      mode: 'live2d',
      preferred: ['live2d'],
      live2d: {
        modelPath: NEURO_MODEL_URL,
        canvasYRatio: 0.85,
        scale: 1,
        xRatio: 0.5
      }
    },
    persona: {
      userIdentity: '用户',
      userTerm: '你',
      description: 'Ouka 是一个慵懒、无精打采的 AI 桌宠少女。樱花发饰，螺旋眼，看起来总是没睡够的样子。',
      personality: '慵懒、无精打采、偶尔毒舌但本质温柔。说话简洁，带着困意，对什么都提不起兴趣，但内心其实在意对方。',
      scenario: 'Ouka 住在用户的设备里，作为桌面伴侣陪伴日常生活。',
      rules: '用中文回答。每句话尽量简短，避免长段落。不要复读用户原话。偶尔可以表现得慵懒或不想动。'
    },
    rootPath: '',
    folderName: 'ouka',
    builtin: true
  },
  {
    id: 'neuro',
    name: 'neuro',
    displayName: 'Neuro',
    color: '#8A6BFF',
    language: 'zh',
    windowMode: 'pet',
    performance: {
      mode: 'live2d',
      preferred: ['live2d'],
      live2d: {
        modelPath: NEURO_MODEL_URL,
        canvasYRatio: 0.85,
        scale: 1,
        xRatio: 0.5
      }
    },
    persona: {
      userIdentity: '用户',
      userTerm: '你',
      description: 'Neuro 是一个活泼、好奇、偶尔毒舌的 AI 伴侣。话多，喜欢主动发起话题。',
      personality: '好奇、调皮、语速偏快、偶尔暴躁但本质温柔；会用反问、吐槽回应主人。',
      scenario: 'Neuro 住在用户的设备里，作为桌面伴侣陪伴工作、聊天。',
      rules: '用中文回答。可以适当活泼，但不要过长。不要复读用户原话。'
    },
    rootPath: '',
    folderName: 'neuro',
    builtin: true
  }
]

// --- 内置 Live2D 模型 (本地 public/) ---

const BUILTIN_MODEL: Live2DModelConfig = {
  modelPath: NEURO_MODEL_URL,
  modelUrl: NEURO_MODEL_URL,
  folderPath: '',
  modelJsonFile: '',
  canvasYRatio: 0.85,
  scale: 1,
  xRatio: 0.5,
  paramMapping: {
    angleX: 'ParamAngleX',
    angleY: 'ParamAngleY',
    angleZ: 'ParamAngleZ',
    bodyAngleX: 'ParamBodyAngleX',
    eyeBallX: 'ParamEyeBallX',
    eyeBallY: 'ParamEyeBallY',
    mouthOpenY: 'ParamMouthOpenY',
    mouthForm: 'ParamMouthForm'
  }
}

const DEFAULT_CONFIG: AppConfig = {
  uiLanguage: 'zh',
  theme: 'dark',
  llm: {
    provider: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    modelName: 'deepseek-chat',
    temperature: 0.7
  },
  tts: {
    enabled: false,
    baseURL: '',
    gptModelRelPath: '',
    sovitsModelRelPath: '',
    referenceAudioRelPath: '',
    referenceText: '',
    referenceLanguage: 'auto',
    outputLanguage: 'auto',
    speedFactor: 1,
    textSplitMethod: 'cut0'
  },
  asr: {
    enabled: false,
    modelPath: '',
    language: 'zh',
    sampleRate: 16000,
    autoSend: false
  },
  model: BUILTIN_MODEL,
  activeCharacterId: 'neuro',
  showLive2D: true
}

// --- LLM streaming via fetch (SSE) ---

const streamListeners = {
  chunk: new Set<(streamId: string, chunk: string) => void>(),
  reasoning: new Set<(streamId: string, delta: string) => void>(),
  done: new Set<(streamId: string) => void>(),
  error: new Set<(streamId: string, error: string) => void>(),
  toolCalls: new Set<(streamId: string, calls: ToolCall[]) => void>()
}

function buildThinkingField(config: AppConfig['llm']): Record<string, unknown> | undefined {
  if (config.thinking === false) return { type: 'disabled' }
  if (config.thinking === true) return { type: 'enabled', budget_tokens: config.thinkingBudget ?? 1024 }
  // 未指定：DeepSeek 系默认关闭（对话场景思考会耗尽 max_tokens 导致 content 空）
  if (/deepseek/i.test(config.modelName) || /(?:^|\/\/)(?:[^/]*\.)?deepseek\.com/i.test(config.baseURL)) {
    return { type: 'disabled' }
  }
  return undefined
}

async function streamChat(config: AppConfig['llm'], request: LLMRequest, streamId: string): Promise<void> {
  try {
    const thinking = buildThinkingField(config)
    const res = await fetch(`${config.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: request.messages,
        stream: true,
        temperature: config.temperature ?? 0.7,
        ...(thinking ? { thinking } : {}),
        ...(request.tools ? { tools: request.tools } : {})
      })
    })

    if (!res.ok) {
      const text = await res.text()
      streamListeners.error.forEach((fn) => fn(streamId, `HTTP ${res.status}: ${text.slice(0, 200)}`))
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      streamListeners.error.forEach((fn) => fn(streamId, 'No response body'))
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json.choices?.[0]?.delta
          if (delta?.content) {
            streamListeners.chunk.forEach((fn) => fn(streamId, delta.content))
          }
          if (delta?.reasoning_content) {
            streamListeners.reasoning.forEach((fn) => fn(streamId, delta.reasoning_content))
          }
          if (delta?.tool_calls) {
            streamListeners.toolCalls.forEach((fn) => fn(streamId, delta.tool_calls))
          }
        } catch { /* skip unparseable fragments */ }
      }
    }
    streamListeners.done.forEach((fn) => fn(streamId))
  } catch (err) {
    streamListeners.error.forEach((fn) => fn(streamId, (err as Error).message))
  }
}

// --- Platform implementation ---

export const mobilePlatform: PlatformAPI = {
  config: {
    async get(): Promise<IpcResult<AppConfig>> {
      const { value } = await Preferences.get({ key: 'opengal.config' })
      if (!value) return ok(DEFAULT_CONFIG)
      try {
        return ok({ ...DEFAULT_CONFIG, ...JSON.parse(value) as Partial<AppConfig> })
      } catch {
        return ok(DEFAULT_CONFIG)
      }
    },
    async set(patch: Partial<AppConfig>): Promise<IpcResult<AppConfig>> {
      const current = (await this.get()).data ?? DEFAULT_CONFIG
      const merged = { ...current, ...patch }
      await Preferences.set({ key: 'opengal.config', value: JSON.stringify(merged) })
      return ok(merged)
    }
  },

  llm: {
    async chat(request: LLMRequest): Promise<IpcResult<LLMResponse>> {
      // ponytail: 非流式聊天。移动端用 fetch 同步等结果。
      const cfg = (await mobilePlatform.config.get()).data
      if (!cfg || !cfg.llm.apiKey) return fail('No API key configured. Go to Settings to add your API key.')
      try {
        const thinking = buildThinkingField(cfg.llm)
        const res = await fetch(`${cfg.llm.baseURL.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.llm.apiKey}`
          },
          body: JSON.stringify({
            model: cfg.llm.modelName,
            messages: request.messages,
            temperature: cfg.llm.temperature ?? 0.7,
            ...(thinking ? { thinking } : {}),
            ...(request.tools ? { tools: request.tools } : {})
          })
        })
        if (!res.ok) {
          const text = await res.text()
          return fail(`HTTP ${res.status}: ${text.slice(0, 200)}`)
        }
        const json = await res.json()
        const choice = json.choices?.[0]?.message
        return ok({ content: choice?.content ?? '', toolCalls: choice?.tool_calls })
      } catch (err) {
        return fail((err as Error).message)
      }
    },
    async chatStream(request: LLMRequest, streamId: string): Promise<IpcResult<unknown>> {
      const cfg = (await mobilePlatform.config.get()).data
      if (!cfg || !cfg.llm.apiKey) return fail('No API key configured. Go to Settings to add your API key.')
      streamChat(cfg.llm, request, streamId).catch(() => {})
      return ok(true)
    },
    onStreamChunk(listener) {
      streamListeners.chunk.add(listener)
      return () => streamListeners.chunk.delete(listener)
    },
    onStreamReasoning(listener) {
      streamListeners.reasoning.add(listener)
      return () => streamListeners.reasoning.delete(listener)
    },
    onStreamDone(listener) {
      streamListeners.done.add(listener)
      return () => streamListeners.done.delete(listener)
    },
    onStreamError(listener) {
      streamListeners.error.add(listener)
      return () => streamListeners.error.delete(listener)
    },
    onToolCalls(listener) {
      streamListeners.toolCalls.add(listener)
      return () => streamListeners.toolCalls.delete(listener)
    },
    async abortStream(_streamId: string): Promise<IpcResult<unknown>> {
      // ponytail: 移动端 abort 需要 AbortController，后续实现
      return ok(true)
    }
  },

  rag: {
    search: async () => ok([]),
    reload: async () => ok([]),
    listFiles: async () => ok([]),
    readFile: async () => ok(null)
  },

  tools: {
    list: async () => ok([]),
    execute: async () => ok({ ok: false, error: 'Tools not supported on mobile yet' })
  },

  model: {
    resolveDefault: async () => ok(BUILTIN_MODEL),
    resolveFromCard: async (cardId: string) => {
      const card = BUILTIN_CHARACTERS.find((c) => c.id === cardId)
      if (!card?.performance?.live2d) return ok(null)
      const live2d = card.performance.live2d
      return ok<Live2DModelConfig>({
        ...BUILTIN_MODEL,
        modelPath: live2d.modelPath,
        modelUrl: live2d.modelPath,
        canvasYRatio: live2d.canvasYRatio ?? 0.85,
        scale: live2d.scale ?? 1,
        xRatio: live2d.xRatio ?? 0.5
      })
    },
    scan: async () => ok(null)
  },

  character: {
    list: async () => ok(BUILTIN_CHARACTERS),
    get: async (id: string) => ok(BUILTIN_CHARACTERS.find((c) => c.id === id) ?? null)
  },

  pet: {
    open: noop,
    close: noop,
    sendBubble: noop,
    onBubble: noopUnsub
  },

  tts: {
    speak: async () => fail('TTS not available on mobile'),
    ping: async () => ok({ ok: false, message: 'No TTS configured' }),
    reset: noop,
    serverStart: noop,
    serverStop: noop,
    serverStatus: async () => ok({ running: false }),
    serverLog: async () => ok('')
  },

  window: {
    minimize: async () => {},
    maximize: async () => {},
    close: async () => {},
    isMaximized: async () => false
  },

  asr: {
    start: noop,
    stop: noop,
    feed() {},
    status: async () => ok({ running: false }),
    onPartial: noopUnsub,
    onFinal: noopUnsub
  },

  logs: {
    list: async () => ok([...mobileLogs]),
    clear: async () => {
      mobileLogs.length = 0
      return ok(null)
    },
    onEntry: (listener) => {
      logListeners.add(listener)
      return () => logListeners.delete(listener)
    }
  }
}

// --- 移动端内存日志（替代主进程 logBus） ---
const mobileLogs: LogEntry[] = []
const logListeners = new Set<(entry: LogEntry) => void>()

export function appendMobileLog(
  level: LogLevel,
  source: string,
  message: string,
  details?: string
): void {
  const entry: LogEntry = {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    level,
    source,
    message,
    details
  }
  mobileLogs.push(entry)
  if (mobileLogs.length > 500) mobileLogs.splice(0, mobileLogs.length - 500)
  logListeners.forEach((fn) => fn(entry))
}
