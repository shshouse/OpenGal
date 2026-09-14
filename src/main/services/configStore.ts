import Store from 'electron-store'
import { safeStorage } from 'electron'
import type { AppConfig } from '@shared/types'
import { toModUrl, getDataRoot } from './paths'
import { listRoleCards, readRoleVoiceConfig } from './roleCardLoader'
import { logBus } from './logBus'
import { normalizeAsrEngine } from '../../shared/asrKinds'

const defaultConfig: AppConfig = {
  uiLanguage: 'zh',
  theme: 'system',
  llm: {
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    modelName: 'deepseek-chat',
    temperature: 0.86,
    maxTokens: 4096
  },
  memory: {
    factBudgetChars: 4000,
    storyBudgetChars: 3000,
    injectCharCap: 900,
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
    modelPath: '',
    language: 'zh',
    sampleRate: 16000,
    autoSend: true,
    deviceId: '',
    hotwords: [],
    vadSilenceMs: 600,
    directorEnabled: false,
    directorScreenContext: false,
    directorCooldownSec: 20
  },
  model: null,
  activeCharacterId: null,
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
    const storedLlm = (store.store as Record<string, unknown>).llm as Record<string, unknown> | undefined
    if (storedLlm && storedLlm.maxTokens === 2048) {
      store.set('llm.maxTokens' as never, 4096 as never)
    }
  }
  return store
}

function encryptApiKey(key: string): string {
  if (!key) return ''
  if (!safeStorage.isEncryptionAvailable()) return key
  return safeStorage.encryptString(key).toString('base64')
}

function decryptApiKey(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return value
  }
}

// 密钥掩码：config.get 下发渲染进程时隐藏真实密钥；回写时遇掩码则从当前配置还原
export const SECRET_MASK = '••••••••••••'

function mask(value: string): string {
  return value ? SECRET_MASK : ''
}

export function redactSecrets(cfg: AppConfig): AppConfig {
  return {
    ...cfg,
    llm: { ...cfg.llm, apiKey: mask(cfg.llm.apiKey) },
    llmPresets: cfg.llmPresets?.map((p) => ({ ...p, apiKey: mask(p.apiKey) })),
    tools: {
      ...cfg.tools,
      webSearch: { ...cfg.tools.webSearch, tavilyKey: mask(cfg.tools.webSearch.tavilyKey) },
    },
  }
}

function restoreMaskedSecrets(patch: Partial<AppConfig>, current: AppConfig): void {
  if (patch.llm?.apiKey === SECRET_MASK) {
    patch.llm.apiKey =
      current.llmPresets?.find(
        (p) => p.baseURL === patch.llm!.baseURL && p.modelName === patch.llm!.modelName,
      )?.apiKey ?? current.llm.apiKey
  }
  if (patch.llmPresets) {
    for (const p of patch.llmPresets) {
      if (p.apiKey === SECRET_MASK) {
        p.apiKey = current.llmPresets?.find((c) => c.id === p.id)?.apiKey ?? ''
      }
    }
  }
  if (patch.tools?.webSearch?.tavilyKey === SECRET_MASK) {
    patch.tools.webSearch.tavilyKey = current.tools.webSearch.tavilyKey
  }
}

// 渲染进程拿着掩码发起需要真实密钥的请求（如拉模型列表）时还原
export function resolveMaskedApiKey(baseURL: string, apiKey: string): string {
  if (apiKey !== SECRET_MASK) return apiKey
  const cfg = readConfig()
  return cfg.llmPresets?.find((p) => p.baseURL === baseURL)?.apiKey ?? cfg.llm.apiKey
}

function patchTTSFromVoiceConfig(tts: AppConfig['tts']): void {
  if (tts.gptModelRelPath && tts.sovitsModelRelPath) return
  try {
    for (const card of listRoleCards()) {
      const raw = readRoleVoiceConfig(card)
      if (!raw) continue
      if (!tts.gptModelRelPath && raw.gptModel) tts.gptModelRelPath = raw.gptModel as string
      if (!tts.sovitsModelRelPath && raw.sovitsModel) tts.sovitsModelRelPath = raw.sovitsModel as string
      if (!tts.referenceAudioRelPath && raw.referenceAudio) {
        tts.referenceAudioRelPath = raw.referenceAudio as string
      }
      if (!tts.referenceText && raw.referenceText) tts.referenceText = raw.referenceText as string
      if (!tts.referenceLanguage && raw.referenceLanguage) {
        tts.referenceLanguage = raw.referenceLanguage as AppConfig['tts']['referenceLanguage']
      }
      if (!tts.outputLanguage && raw.outputLanguage) {
        tts.outputLanguage = raw.outputLanguage as AppConfig['tts']['outputLanguage']
      }
      if (!tts.baseURL && raw.baseURL) tts.baseURL = raw.baseURL as string
      return
    }
  } catch (err) {
    console.error('[TTS] patchTTSFromVoiceConfig failed:', err)
  }
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
    gameMode: { ...defaultConfig.gameMode, ...(raw.gameMode ?? {}) }
  }
  merged.asr.engine = normalizeAsrEngine(merged.asr.engine as string)
  merged.llm.apiKey = decryptApiKey(merged.llm.apiKey)
  if (merged.model && !merged.model.modelUrl && merged.model.modelPath) {
    merged.model.modelUrl = toModUrl(merged.model.modelPath)
  }
  patchTTSFromVoiceConfig(merged.tts)
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
  restoreMaskedSecrets(patch, current)
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
  const persisted: AppConfig = {
    ...next,
    llm: { ...next.llm, apiKey: encryptApiKey(next.llm.apiKey) }
  }
  getStore().set(persisted as unknown as Record<string, unknown>)
  logBus.info('config', `配置更新: ${summarizePatch(patch)}`)
  return next
}

export function resetConfig(): AppConfig {
  getStore().clear()
  logBus.warn('config', '配置已重置为默认值')
  return readConfig()
}
