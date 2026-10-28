import Store from 'electron-store'
import { app, safeStorage } from 'electron'
import type { AppConfig } from '@shared/types'
import { toModUrl, getDataRoot } from './paths'
import { logBus } from './logBus'
import { normalizeAsrEngine, normalizeAsrMode } from '../../shared/asrKinds'

const defaultConfig: AppConfig = {
  uiLanguage: 'zh',
  theme: 'system',
  llm: {
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    modelName: 'deepseek-chat',
    temperature: 0.86,
    maxTokens: 4096,
    contextWindow: 1048576
  },
  memory: {
    injectCharCap: 8000,
    batchTurns: 8,
    idleMinutes: 5,
    fallbackHours: 12
  },
  tts: {
    enabled: false,
    provider: 'gpt-sovits',
    baseURL: 'http://127.0.0.1:39880',
    gptModelRelPath: '',
    sovitsModelRelPath: '',
    characterName: '',
    onnxModelDir: '',
    referenceAudioRelPath: '',
    referenceText: '',
    referenceLanguage: 'en',
    outputLanguage: 'auto',
    speedFactor: 1,
    textSplitMethod: 'cut5'
  },
  asr: {
    enabled: false,
    engine: 'sherpa',
    mode: 'offline',
    modelPath: '',
    language: 'zh',
    sampleRate: 16000,
    autoSend: true,
    deviceId: '',
    hotwords: [],
    vadSilenceMs: 600,
    directorEnabled: false,
    directorMode: 'agent',
    directorDirectSpeech: false,
    directorScreenContext: false,
    directorCooldownSec: 20,
    directorInitiativeEnabled: false,
    directorInitiativePerHour: 3,
    directorIdleMinutes: 10
  },
  model: null,
  activeCharacterId: null,
  runningCharacters: {},
  showLive2D: true,
  tools: {
    webSearch: {
      provider: 'bing',
      tavilyKey: ''
    },
    fileSearchDirs: []
  },
  gameMode: {
    enabled: true,
    games: []
  },
  startup: {
    greetingEnabled: true
  },
  screen: {
    excludeSelf: true
  }
}

let store: Store<Record<string, unknown>> | null = null

function getStore(): Store<Record<string, unknown>> {
  if (!store) {
    store = new Store<Record<string, unknown>>({
      name: 'opengal-config',
      cwd: getDataRoot(),
      defaults: { ...defaultConfig } as unknown as Record<string, unknown>
    })
    if (store.get('migrations.memoryGenerousDefaults') !== true) {
      const mem = (store.get('memory') ?? {}) as Record<string, unknown>
      if (mem.injectCharCap === 900) store.set('memory', { ...mem, injectCharCap: 8000 })
      store.set('migrations.memoryGenerousDefaults', true)
    }
    const storedLlm = (store.store as Record<string, unknown>).llm as Record<string, unknown> | undefined
    if (storedLlm && storedLlm.maxTokens === 2048) {
      store.set('llm.maxTokens' as never, 4096 as never)
    }
  }
  return store
}

// safeStorage 在 Windows 下是 v10 前缀的 AES-GCM 密文，可据此识别“已经是密文”
function isCiphertext(value: string): boolean {
  const raw = Buffer.from(value, 'base64')
  return raw.length > 15 && raw.subarray(0, 3).toString() === 'v10'
}

function encryptApiKey(key: string): string {
  if (!key) return ''
  if (!safeStorage.isEncryptionAvailable()) return key
  if (isCiphertext(key)) return key
  return safeStorage.encryptString(key).toString('base64')
}

// 解密失败不能把密文当明文返回：否则下次保存会把密文再加密一次，密钥层层嵌套彻底不可用
function decryptApiKey(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) return value
  let cur = value
  for (let i = 0; i < 3; i += 1) {
    if (!isCiphertext(cur)) return cur
    try {
      cur = safeStorage.decryptString(Buffer.from(cur, 'base64'))
    } catch {
      logBus.error('config', '密钥解密失败，需重新填写（通常因 userData 目录变动）')
      return ''
    }
  }
  return ''
}

export function readConfig(): AppConfig {
  const raw = getStore().store as unknown as AppConfig
  const merged: AppConfig = {
    ...defaultConfig,
    ...raw,
    llm: { ...defaultConfig.llm, ...(raw.llm ?? {}) },
    tts: { ...defaultConfig.tts, ...(raw.tts ?? {}) },
    asr: { ...defaultConfig.asr, ...(raw.asr ?? {}) },
    memory: { ...defaultConfig.memory, ...(raw.memory ?? {}) },
    tools: {
      ...defaultConfig.tools,
      ...(raw.tools ?? {}),
      webSearch: { ...defaultConfig.tools.webSearch, ...(raw.tools?.webSearch ?? {}) },
      fileSearchDirs: raw.tools?.fileSearchDirs ?? defaultConfig.tools.fileSearchDirs,
    },
    gameMode: { ...defaultConfig.gameMode, ...(raw.gameMode ?? {}) },
    startup: { ...defaultConfig.startup, ...(raw.startup ?? {}) }
  }
  merged.asr.engine = normalizeAsrEngine(merged.asr.engine as string)
  merged.asr.mode = normalizeAsrMode(merged.asr.mode as string)
  merged.systemLocale = app.getPreferredSystemLanguages()[0] || app.getLocale()
  merged.llm.apiKey = decryptApiKey(merged.llm.apiKey)
  // 缺键时不要制造 undefined 属性：writeConfig 是整对象写回，conf 见到顶层 undefined 会抛错
  if (merged.llmPresets) {
    merged.llmPresets = merged.llmPresets.map((p) => ({ ...p, apiKey: decryptApiKey(p.apiKey) }))
  }
  if (merged.model && !merged.model.modelUrl && merged.model.modelPath) {
    merged.model.modelUrl = toModUrl(merged.model.modelPath)
  }
  return merged
}

function summarizePatch(patch: Partial<AppConfig>): string {
  const keys: string[] = []
  if (patch.llm) keys.push(`llm{${Object.keys(patch.llm).join(',')}}`)
  if (patch.tts) keys.push(`tts{${Object.keys(patch.tts).join(',')}}`)
  for (const k of Object.keys(patch) as Array<keyof AppConfig>) {
    if (k !== 'llm' && k !== 'tts') keys.push(String(k))
  }
  return keys.join(', ')
}

export function writeConfig(patch: Partial<AppConfig>): AppConfig {
  const current = readConfig()
  const next: AppConfig = {
    ...current,
    ...patch,
    llm: { ...current.llm, ...(patch.llm ?? {}) },
    tts: { ...current.tts, ...(patch.tts ?? {}) },
    asr: { ...current.asr, ...(patch.asr ?? {}) },
    tools: {
      ...current.tools,
      ...(patch.tools ?? {}),
      webSearch: { ...current.tools.webSearch, ...(patch.tools?.webSearch ?? {}) },
      fileSearchDirs: patch.tools?.fileSearchDirs ?? current.tools.fileSearchDirs,
    },
    gameMode: { ...current.gameMode, ...(patch.gameMode ?? {}) },
    model: patch.model === undefined ? current.model : patch.model
  }
  const persisted: Record<string, unknown> = {
    ...next,
    llm: { ...next.llm, apiKey: encryptApiKey(next.llm.apiKey) }
  }
  if (next.llmPresets) {
    persisted.llmPresets = next.llmPresets.map((p) => ({ ...p, apiKey: encryptApiKey(p.apiKey) }))
  }
  // conf 的 set(object) 逐键写入，顶层 undefined 会抛 TypeError（JSON 不支持 undefined）
  for (const key of Object.keys(persisted)) {
    if (persisted[key] === undefined) delete persisted[key]
  }
  getStore().set(persisted)
  logBus.info('config', `配置更新: ${summarizePatch(patch)}`)
  return next
}
