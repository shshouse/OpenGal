import Store from 'electron-store'
import { safeStorage } from 'electron'
import type { AppConfig } from '@shared/types'
import { toModUrl, getDataRoot } from './paths'
import { listRoleCards, readRoleVoiceConfig } from './roleCardLoader'
import { logBus } from './logBus'
import { migrateLegacyData } from './dataMigration'

const defaultConfig: AppConfig = {
  uiLanguage: 'zh',
  theme: 'system',
  llm: {
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: '',
    modelName: 'x-ai/grok-4.1-fast',
    temperature: 0.86,
    maxTokens: 4096
  },
  tts: {
    enabled: false,
    provider: 'gpt-sovits',
    baseURL: 'http://127.0.0.1:9880',
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
    modelPath: '',
    language: 'zh',
    sampleRate: 16000,
    autoSend: true
  },
  model: null,
  activeCharacterId: null,
  showLive2D: true
}

// 惰性初始化：首次访问时才定位便携数据根（依赖 app 路径解析，生产环境需等 app 就绪）
// 并先把散落在 AppData 的旧数据一次性迁移过来（幂等，见 dataMigration.ts）。
let store: Store<Record<string, unknown>> | null = null

function getStore(): Store<Record<string, unknown>> {
  if (!store) {
    migrateLegacyData()
    store = new Store<Record<string, unknown>>({
      name: 'opengal-config',
      cwd: getDataRoot(),
      defaults: { ...defaultConfig } as unknown as Record<string, unknown>
    })
    // One-time migration: bump old default maxTokens 2048 -> 4096
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

/**
 * 首次启动时从角色卡的语音配置回填 TTS 路径（仅当字段为空时）。
 *
 * 历史上这函数会无条件用 voice 文件覆盖 baseURL/referenceLanguage/outputLanguage，
 * 导致用户在设置面板里改的全局值被静默还原——尤其是用户改 baseURL 端口时。
 * 现在严格遵守"用户已有非空值优先"原则，所有字段都只在为空时才回填。
 *
 * 角色卡感知层面，speak 路径已通过 cardVoice 覆盖 globalConfig 实现真正的
 * per-role 配置（见 gptSovitsAdapter.resolveSettings），不再需要这函数兜底。
 * 数据来源是扫描到的第一张带语音配置的角色卡，不写死任何具体角色。
 */
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
    asr: { ...defaultConfig.asr, ...(raw.asr ?? {}) }
  }
  merged.llm.apiKey = decryptApiKey(merged.llm.apiKey)
  // Patch legacy model configs that are missing modelUrl
  if (merged.model && !merged.model.modelUrl && merged.model.modelPath) {
    merged.model.modelUrl = toModUrl(merged.model.modelPath)
  }
  // Auto-fill TTS from voice config.json if paths are empty
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
  const next: AppConfig = {
    ...current,
    ...patch,
    llm: { ...current.llm, ...(patch.llm ?? {}) },
    tts: { ...current.tts, ...(patch.tts ?? {}) },
    asr: { ...current.asr, ...(patch.asr ?? {}) },
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
