import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
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
  RoleCardEntry,
  ToolDefinition
} from '@shared/types'
import type { LogEntry } from '@shared/log'
import type { MateControl, MateStatePayload } from '@shared/mate'

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
      invoke<{ facts: MemoryFact[]; stories: MemoryStory[]; block: string | null }>(
        IpcChannels.memory.getRelevant,
        roleId,
        context
      )
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
    get: (id: string) => invoke<RoleCardEntry | null>(IpcChannels.role.get, id),
    voiceConfig: (id: string) =>
      invoke<Record<string, unknown> | null>(IpcChannels.role.voiceConfig, id)
  },
  chatHistory: {
    load: (roleId: string) => invoke<ChatMessage[]>(IpcChannels.chatHistory.load, roleId),
    append: (roleId: string, messages: ChatMessage[]) =>
      invoke<number[]>(IpcChannels.chatHistory.append, roleId, messages),
    replaceAll: (roleId: string, messages: ChatMessage[]) =>
      invoke<boolean>(IpcChannels.chatHistory.replaceAll, roleId, messages),
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
