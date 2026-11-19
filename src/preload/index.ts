import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/app/ipc-channels'
import type {
  AppConfig,
  ChatMessage,
  IpcResult,
  LLMRequest,
  LLMResponse,
  LlmStreamEvent,
  Live2DModelConfig,
  MemoryApplyPayload,
  MemoryChange,
  MemoryFact,
  MemoryStory,
  PluginInfo,
  RoleCardEditableFields,
  RoleCardEntry,
  RoleCardSaveResult,
  ToolDefinition
} from '@shared/types'
import type { LogEntry } from '@shared/app/log'
import type { DiscoveredModSummary } from '@core/mods/manifest'
import type { LifeLogEntry, RoleMode, RoleStateSnapshot } from '@core/role/types'
import type { WorkshopDraft } from '@core/workshop/types'
import type { RoleOutfitChange } from '@shared/role'
import type { MateControl, MateStatePayload } from '@shared/ui/mate'
import type { UIState, UIStatePatch } from '@shared/ui/uiState'
import type { StorageUsage } from '@shared/app/storage'

export interface RuntimeRoleItemView {
  roleId: string
  displayName: string
  mode: RoleMode
  running: boolean
  lifePaused: boolean
  thinking: boolean
  state: RoleStateSnapshot
}

export interface RuntimePoolSnapshotView {
  focusedRoleId: string | null
  runningRoleIds: string[]
  roles: Record<string, RuntimeRoleItemView>
}

export interface AutonomousSpeakEvent {
  roleId: string
  line: string
  mood: string
  activity: string
  ts: number
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>
}

function mateControl(type: MateControl): Promise<IpcResult<unknown>> {
  return invoke(IpcChannels.mate.control, type)
}

function mateSync(payload: MateStatePayload): void {
  ipcRenderer.send(IpcChannels.mate.sync, payload)
}

const api = {
  config: {
    get: () => invoke<AppConfig>(IpcChannels.config.get),
    set: (patch: Partial<AppConfig>) => invoke<AppConfig>(IpcChannels.config.set, patch)
  },
  uiState: {
    get: () => invoke<UIState>(IpcChannels.uiState.get),
    set: (patch: UIStatePatch) => invoke<UIState>(IpcChannels.uiState.set, patch)
  },
  storage: {
    usage: () => invoke<StorageUsage>(IpcChannels.storage.usage),
    reveal: () => invoke<void>(IpcChannels.storage.reveal)
  },
  llm: {
    chat: (request: LLMRequest) => invoke<LLMResponse>(IpcChannels.llm.chat, request),
    chatStream: (request: LLMRequest, streamId: string) =>
      invoke(IpcChannels.llm.chatStream, request, streamId),
    onStream: (listener: (event: LlmStreamEvent) => void) => {
      const handler = (_: unknown, event: LlmStreamEvent) => listener(event)
      ipcRenderer.on(IpcChannels.llm.stream, handler)
      return () => ipcRenderer.off(IpcChannels.llm.stream, handler)
    },
    abortStream: (streamId: string) => invoke(IpcChannels.llm.streamAbort, streamId),
    listModels: (baseURL: string, apiKey: string) =>
      invoke<string[]>(IpcChannels.llm.listModels, baseURL, apiKey)
  },
  tools: {
    list: () => invoke<ToolDefinition[]>(IpcChannels.tools.list),
    execute: (name: string, argsJson: string) =>
      invoke<{ ok: true; result: string } | { ok: false; error: string }>(
        IpcChannels.tools.execute,
        name,
        argsJson
      )
  },
  plugins: {
    list: () => invoke<PluginInfo[]>(IpcChannels.plugins.list),
    setEnabled: (pluginId: string, enabled: boolean) =>
      invoke<PluginInfo[]>(IpcChannels.plugins.setEnabled, pluginId, enabled),
    rescan: () => invoke<PluginInfo[]>(IpcChannels.plugins.rescan)
  },
  memory: {
    get: (roleId: string) =>
      invoke<{ facts: MemoryFact[]; stories: MemoryStory[]; block: string | null }>(
        IpcChannels.memory.get,
        roleId
      ),
    apply: (roleId: string, payload: MemoryApplyPayload) =>
      invoke<{
        insertedFacts: number
        refreshedFacts: number
        insertedStories: number
      }>(IpcChannels.memory.apply, roleId, payload),
    manualAdd: (roleId: string, text: string, entity?: MemoryFact['entity']) =>
      invoke<MemoryFact>(IpcChannels.memory.manualAdd, roleId, text, entity),
    clear: (roleId: string) => invoke<void>(IpcChannels.memory.clear, roleId),
    pending: (roleId: string, limit?: number) =>
      invoke<{
        cursor: number
        entries: Array<{ role: 'user' | 'assistant'; text: string; at: number }>
      }>(IpcChannels.memory.pending, roleId, limit),
    advanceCursor: (roleId: string, ts: number) =>
      invoke<void>(IpcChannels.memory.advanceCursor, roleId, ts),
    rebuild: (roleId: string) =>
      invoke<{ facts: number; stories: number }>(
        IpcChannels.memory.rebuild,
        roleId,
        `rebuild:${roleId}`
      ),
    freezeFact: (roleId: string, factId: string) =>
      invoke<boolean>(IpcChannels.memory.freezeFact, roleId, factId),
    unfreezeFact: (roleId: string, factId: string) =>
      invoke<boolean>(IpcChannels.memory.unfreezeFact, roleId, factId),
    deleteFact: (roleId: string, factId: string) =>
      invoke<boolean>(IpcChannels.memory.deleteFact, roleId, factId),
    prune: (roleId: string) =>
      invoke<{ archived: number }>(IpcChannels.memory.prune, roleId),
    evidence: (roleId: string, memoryId: string) =>
      invoke<Array<{ id: number; role: string; content: string; ts: number }>>(
        IpcChannels.memory.evidence,
        roleId,
        memoryId
      ),
    changes: (roleId: string, memoryId: string, limit?: number) =>
      invoke<MemoryChange[]>(IpcChannels.memory.changes, roleId, memoryId, limit),
    getRelevant: (roleId: string, context: string) =>
      invoke<{ block: string | null }>(
        IpcChannels.memory.getRelevant,
        roleId,
        context
      )
  },
  mods: {
    list: () => invoke<Array<DiscoveredModSummary & { rootPath: string }>>(IpcChannels.mods.list)
  },
  runtime: {
    snapshot: () => invoke<RuntimePoolSnapshotView>(IpcChannels.runtime.snapshot),
    setRunning: (roleId: string, running: boolean) =>
      invoke<RuntimePoolSnapshotView>(IpcChannels.runtime.setRunning, roleId, running),
    setMode: (roleId: string, mode: RoleMode) =>
      invoke<RuntimePoolSnapshotView>(IpcChannels.runtime.setMode, roleId, mode),
    setLifePaused: (roleId: string, paused: boolean) =>
      invoke<RuntimePoolSnapshotView>(IpcChannels.runtime.setLifePaused, roleId, paused),
    focus: (roleId: string | null) =>
      invoke<RuntimePoolSnapshotView>(IpcChannels.runtime.focus, roleId),
    notifyUserActivity: (roleId: string) =>
      invoke<boolean>(IpcChannels.runtime.userActivity, roleId),
    triggerLifeTick: (roleId: string) =>
      invoke<boolean>(IpcChannels.runtime.triggerLifeTick, roleId),
    onChanged: (listener: (snapshot: RuntimePoolSnapshotView) => void) => {
      const handler = (_: unknown, snapshot: RuntimePoolSnapshotView) => listener(snapshot)
      ipcRenderer.on(IpcChannels.runtime.changed, handler)
      return () => ipcRenderer.off(IpcChannels.runtime.changed, handler)
    },
    onAutonomousSpeak: (listener: (event: AutonomousSpeakEvent) => void) => {
      const handler = (_: unknown, event: AutonomousSpeakEvent) => listener(event)
      ipcRenderer.on(IpcChannels.runtime.autonomousSpeak, handler)
      return () => ipcRenderer.off(IpcChannels.runtime.autonomousSpeak, handler)
    }
  },
  workshop: {
    list: () => invoke<WorkshopDraft[]>(IpcChannels.workshop.list),
    get: (draftId: string) => invoke<WorkshopDraft | null>(IpcChannels.workshop.get, draftId),
    save: (input: {
      draftId?: string
      name: string
      displayName?: string
      color?: string
      language?: string
      mode?: RoleMode
      greeting?: string
      examples?: Array<{ user: string; assistant: string }>
      persona: {
        description: string
        personality: string
        scenario?: string
        rules?: string
        userIdentity?: string
        userTerm?: string
      }
      voice?: Partial<WorkshopDraft['voice']>
      provenance?: Partial<WorkshopDraft['provenance']>
    }) => invoke<WorkshopDraft>(IpcChannels.workshop.save, input),
    delete: (draftId: string) => invoke<boolean>(IpcChannels.workshop.delete, draftId),
    pickAsset: (draftId: string, kind: 'portrait' | 'voice') =>
      invoke<WorkshopDraft | null>(IpcChannels.workshop.pickAsset, draftId, kind),
    fetchAsset: (draftId: string, kind: 'portrait' | 'voice', url: string) =>
      invoke<WorkshopDraft>(IpcChannels.workshop.fetchAsset, draftId, kind, url),
    portraitPreview: (draftId: string) =>
      invoke<string | null>(IpcChannels.workshop.portraitPreview, draftId),
    finalizeRole: (draftId: string) =>
      invoke<RoleCardEntry>(IpcChannels.workshop.finalizeRole, draftId),
    exportMod: (draftId: string) =>
      invoke<{ modPath: string; recipeOnly: boolean } | null>(IpcChannels.workshop.exportMod, draftId),
    publishMikuMod: (draftId: string) =>
      invoke<{ modPath: string; uploadUrl: string; recipeOnly: boolean }>(
        IpcChannels.workshop.publishMikuMod,
        draftId
      ),
    onUpdated: (listener: (draft: WorkshopDraft) => void) => {
      const handler = (_: unknown, draft: WorkshopDraft) => listener(draft)
      ipcRenderer.on(IpcChannels.workshop.updated, handler)
      return () => ipcRenderer.off(IpcChannels.workshop.updated, handler)
    }
  },
  model: {
    resolveDefault: () => invoke<Live2DModelConfig | null>(IpcChannels.model.resolveDefault),
    resolveFromCard: (cardId: string) =>
      invoke<Live2DModelConfig | null>(IpcChannels.model.resolveFromCard, cardId),
    scan: (folderPath: string, modelJsonFile: string) =>
      invoke<Live2DModelConfig | null>(IpcChannels.model.scan, folderPath, modelJsonFile)
  },
  role: {
    list: () => invoke<RoleCardEntry[]>(IpcChannels.role.list),
    templates: () => invoke<RoleCardEntry[]>(IpcChannels.role.templates),
    get: (id: string) => invoke<RoleCardEntry | null>(IpcChannels.role.get, id),
    voiceConfig: (id: string) =>
      invoke<Record<string, unknown> | null>(IpcChannels.role.voiceConfig, id),
    saveCard: (id: string, fields: RoleCardEditableFields) =>
      invoke<RoleCardSaveResult>(IpcChannels.role.saveCard, id, fields),
    createCopy: (id: string, name?: string, mode?: RoleMode) =>
      invoke<RoleCardEntry>(IpcChannels.role.createCopy, id, name, mode),
    createBlank: (input: {
      name: string
      displayName?: string
      color?: string
      language?: string
      mode?: RoleMode
      greeting?: string
      persona: {
        description: string
        personality: string
        scenario?: string
        rules?: string
        userIdentity?: string
        userTerm?: string
      }
    }) => invoke<RoleCardEntry>(IpcChannels.role.createBlank, input),
    delete: (id: string) => invoke<boolean>(IpcChannels.role.delete, id),
    exportFolder: (id: string) => invoke<string | null>(IpcChannels.role.exportFolder, id),
    getState: (id: string) => invoke<RoleStateSnapshot>(IpcChannels.role.getState, id),
    patchState: (id: string, patch: Partial<RoleStateSnapshot>) =>
      invoke<RoleStateSnapshot>(IpcChannels.role.patchState, id, patch),
    lifeLogs: (id: string, limit?: number) =>
      invoke<LifeLogEntry[]>(IpcChannels.role.lifeLogs, id, limit),
    clearLifeLogs: (id: string, scope?: 'all' | 'traces' | 'diary') =>
      invoke<number>(IpcChannels.role.clearLifeLogs, id, scope),
    roleLogs: (id: string, limit?: number) =>
      invoke<Array<{ ts: number; level: string; scope: string; message: string; detail?: string }>>(
        IpcChannels.role.roleLogs,
        id,
        limit
      ),
    onOutfitChanged: (listener: (change: RoleOutfitChange) => void) => {
      const handler = (_: unknown, change: RoleOutfitChange) => listener(change)
      ipcRenderer.on(IpcChannels.role.outfitChanged, handler)
      return () => {
        ipcRenderer.off(IpcChannels.role.outfitChanged, handler)
      }
    }
  },
  chatHistory: {
    load: (roleId: string) => invoke<ChatMessage[]>(IpcChannels.chatHistory.load, roleId),
    append: (roleId: string, messages: ChatMessage[]) =>
      invoke<number[]>(IpcChannels.chatHistory.append, roleId, messages),
    replaceAll: (roleId: string, messages: ChatMessage[]) =>
      invoke<boolean>(IpcChannels.chatHistory.replaceAll, roleId, messages),
    setTranslation: (
      roleId: string,
      target: { dbId?: number; clientId?: string },
      translation: string,
      translationLang: string
    ) =>
      invoke<boolean>(
        IpcChannels.chatHistory.setTranslation,
        roleId,
        target,
        translation,
        translationLang
      ),
    archiveRange: (roleId: string, fromId: number, toId: number) =>
      invoke<number>(IpcChannels.chatHistory.archiveRange, roleId, fromId, toId),
    latestMessageId: (roleId: string) =>
      invoke<number | null>(IpcChannels.chatHistory.latestMessageId, roleId),
    summaries: (roleId: string) =>
      invoke<Array<{ start_ts: number; end_ts: number; text: string; message_count: number }>>(
        IpcChannels.chatHistory.summaries,
        roleId
      ),
    summaryAdd: (
      roleId: string,
      s: { start_ts: number; end_ts: number; text: string; message_count: number }
    ) => invoke<boolean>(IpcChannels.chatHistory.summaryAdd, roleId, s),
    commitCompression: (
      roleId: string,
      fromId: number,
      toId: number,
      s: { start_ts: number; end_ts: number; text: string; message_count: number }
    ) =>
      invoke<{ archived: number }>(
        IpcChannels.chatHistory.commitCompression,
        roleId,
        fromId,
        toId,
        s
      )
  },
  mate: {
    open: () => mateControl('open'),
    close: () => mateControl('close'),
    dragStart: () => mateControl('dragStart'),
    dragMove: () => mateControl('dragMove'),
    setIgnoreMouse: (ignore: boolean) => ipcRenderer.send(IpcChannels.mate.setIgnoreMouse, ignore),
    setDrawerOpen: (open: boolean) =>
      invoke<{ open: boolean }>(IpcChannels.mate.setDrawerOpen, open),
    openStudio: () => invoke<boolean>(IpcChannels.mate.openStudio),
    setBubble: (text: string) => mateSync({ type: 'bubble', text }),
    emitPerformance: (payload: { emotion?: string; motion?: string; roleId?: string; speaking?: boolean }) =>
      mateSync({ type: 'performance', ...payload }),
    emitRuntime: (payload: { runningRoles: Record<string, boolean>; activeRoleId: string | null }) =>
      mateSync({ type: 'runtime', ...payload }),
    emitAvatar: (dataUrl: string) => mateSync({ type: 'avatar', dataUrl }),
    onUpdate: (listener: (payload: MateStatePayload) => void) => {
      const handler = (_: unknown, payload: MateStatePayload) => listener(payload)
      ipcRenderer.on(IpcChannels.mate.update, handler)
      return () => {
        ipcRenderer.off(IpcChannels.mate.update, handler)
      }
    }
  },
  tts: {
    cancel: () => invoke(IpcChannels.tts.cancel),
    speak: (request: { text: string; roleCardId?: string; overrides?: Record<string, unknown> }) =>
      invoke<{ audio: Uint8Array<ArrayBuffer>; mimeType: string; skipped?: boolean }>(
        IpcChannels.tts.speak,
        request
      ),
    ping: () => invoke<{ ok: boolean; message?: string }>(IpcChannels.tts.ping),
    reset: () => invoke(IpcChannels.tts.reset),
    serverStart: () =>
      invoke<{ running: boolean; pid?: number; port?: number; message?: string }>(
        IpcChannels.tts.serverStart
      ),
    serverStop: () =>
      invoke<{ running: boolean; pid?: number; port?: number; message?: string }>(
        IpcChannels.tts.serverStop
      ),
    serverStatus: () =>
      invoke<{ running: boolean; pid?: number; port?: number; message?: string }>(
        IpcChannels.tts.serverStatus
      ),
    serverLog: () => invoke<string>(IpcChannels.tts.serverLog)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IpcChannels.window.minimize),
    maximize: () => ipcRenderer.invoke(IpcChannels.window.maximize),
    close: () => ipcRenderer.invoke(IpcChannels.window.close),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.window.isMaximized) as Promise<boolean>
  },
  asr: {
    onSpeechStart: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on(IpcChannels.asr.speechStart, handler)
      return () => ipcRenderer.off(IpcChannels.asr.speechStart, handler)
    },
    start: () => invoke(IpcChannels.asr.start),
    stop: () => invoke(IpcChannels.asr.stop),
    feed: (pcm16: ArrayBuffer) => ipcRenderer.send(IpcChannels.asr.feed, pcm16),
    status: () => invoke<{ running: boolean }>(IpcChannels.asr.status),
    onPartial: (listener: (text: string) => void) => {
      const handler = (_: unknown, text: string) => listener(text)
      ipcRenderer.on(IpcChannels.asr.partial, handler)
      return () => ipcRenderer.off(IpcChannels.asr.partial, handler)
    },
    onFinal: (listener: (text: string) => void) => {
      const handler = (_: unknown, text: string) => listener(text)
      ipcRenderer.on(IpcChannels.asr.final, handler)
      return () => ipcRenderer.off(IpcChannels.asr.final, handler)
    }
  },
  screen: {
    capture: () => invoke<string>(IpcChannels.screen.capture)
  },
  env: {
    get: () => invoke<import('@shared/types').EnvSnapshot>(IpcChannels.env.get)
  },
  boot: {
    start: () => invoke<import('@shared/types').BootResult>(IpcChannels.boot.start),
    recheckTts: () => invoke(IpcChannels.boot.recheckTts),
    onStep: (listener: (step: import('@shared/types').BootStep) => void) => {
      const handler = (_: unknown, step: import('@shared/types').BootStep) => listener(step)
      ipcRenderer.on(IpcChannels.boot.step, handler)
      return () => ipcRenderer.off(IpcChannels.boot.step, handler)
    }
  },
  market: {
    list: (options: { page?: number; sort?: string; category?: string }) =>
      invoke<import('@shared/types').MarketListResult>(IpcChannels.market.list, options),
    open: (modNumber: number, versionId?: string) =>
      invoke<'desktop' | 'web'>(IpcChannels.market.open, modNumber, versionId)
  },
  director: {
    log: (entry: Record<string, unknown>) => {
      ipcRenderer.send(IpcChannels.director.log, entry)
    }
  },
  logs: {
    list: () => invoke<LogEntry[]>(IpcChannels.logs.list),
    clear: () => invoke(IpcChannels.logs.clear),
    export: (text: string) => invoke<string | null>(IpcChannels.logs.export, text),
    reveal: () => invoke<boolean>(IpcChannels.logs.reveal),
    append: (level: string, source: string, message: string, details?: string) => {
      ipcRenderer.send(IpcChannels.logs.append, level, source, message, details)
    },
    onEntry: (listener: (entry: LogEntry) => void) => {
      const handler = (_: unknown, entry: LogEntry) => listener(entry)
      ipcRenderer.on(IpcChannels.logs.entry, handler)
      return () => ipcRenderer.off(IpcChannels.logs.entry, handler)
    }
  }
}

export type OpenGalAPI = typeof api

if (typeof contextBridge.exposeInMainWorld === 'function') {
  contextBridge.exposeInMainWorld('opengal', api)
} else {
  ;(globalThis as unknown as { opengal: OpenGalAPI }).opengal = api
}
