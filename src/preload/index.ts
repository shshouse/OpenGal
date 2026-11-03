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
    get: (characterId: string) =>
      invoke<{ facts: MemoryFact[]; stories: MemoryStory[]; block: string | null }>(
        IpcChannels.memory.get,
        characterId
      ),
    apply: (characterId: string, payload: MemoryApplyPayload) =>
      invoke<{
        insertedFacts: number
        refreshedFacts: number
        insertedStories: number
      }>(IpcChannels.memory.apply, characterId, payload),
    manualAdd: (characterId: string, text: string, entity?: MemoryFact['entity']) =>
      invoke<MemoryFact>(IpcChannels.memory.manualAdd, characterId, text, entity),
    clear: (characterId: string) => invoke<void>(IpcChannels.memory.clear, characterId),
    pending: (characterId: string, limit?: number) =>
      invoke<{
        cursor: number
        entries: Array<{ role: 'user' | 'assistant'; text: string; at: number }>
      }>(IpcChannels.memory.pending, characterId, limit),
    advanceCursor: (characterId: string, ts: number) =>
      invoke<void>(IpcChannels.memory.advanceCursor, characterId, ts),
    rebuild: (characterId: string) =>
      invoke<{ facts: number; stories: number }>(
        IpcChannels.memory.rebuild,
        characterId,
        `rebuild:${characterId}`
      ),
    freezeFact: (characterId: string, factId: string) =>
      invoke<boolean>(IpcChannels.memory.freezeFact, characterId, factId),
    unfreezeFact: (characterId: string, factId: string) =>
      invoke<boolean>(IpcChannels.memory.unfreezeFact, characterId, factId),
    deleteFact: (characterId: string, factId: string) =>
      invoke<boolean>(IpcChannels.memory.deleteFact, characterId, factId),
    prune: (characterId: string) =>
      invoke<{ archived: number }>(IpcChannels.memory.prune, characterId),
    evidence: (characterId: string, memoryId: string) =>
      invoke<Array<{ id: number; role: string; content: string; ts: number }>>(
        IpcChannels.memory.evidence,
        characterId,
        memoryId
      ),
    getRelevant: (characterId: string, context: string) =>
      invoke<{ facts: MemoryFact[]; stories: MemoryStory[]; block: string | null }>(
        IpcChannels.memory.getRelevant,
        characterId,
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
  character: {
    list: () => invoke<RoleCardEntry[]>(IpcChannels.character.list),
    get: (id: string) => invoke<RoleCardEntry | null>(IpcChannels.character.get, id),
    voiceConfig: (id: string) =>
      invoke<Record<string, unknown> | null>(IpcChannels.character.voiceConfig, id)
  },
  chatHistory: {
    load: (characterId: string) => invoke<ChatMessage[]>(IpcChannels.chatHistory.load, characterId),
    append: (characterId: string, messages: ChatMessage[]) =>
      invoke<number[]>(IpcChannels.chatHistory.append, characterId, messages),
    replaceAll: (characterId: string, messages: ChatMessage[]) =>
      invoke<boolean>(IpcChannels.chatHistory.replaceAll, characterId, messages),
    archiveRange: (characterId: string, fromId: number, toId: number) =>
      invoke<number>(IpcChannels.chatHistory.archiveRange, characterId, fromId, toId),
    latestMessageId: (characterId: string) =>
      invoke<number | null>(IpcChannels.chatHistory.latestMessageId, characterId),
    summaries: (characterId: string) =>
      invoke<Array<{ start_ts: number; end_ts: number; text: string; message_count: number }>>(
        IpcChannels.chatHistory.summaries,
        characterId
      ),
    summaryAdd: (
      characterId: string,
      s: { start_ts: number; end_ts: number; text: string; message_count: number }
    ) => invoke<boolean>(IpcChannels.chatHistory.summaryAdd, characterId, s),
    commitCompression: (
      characterId: string,
      fromId: number,
      toId: number,
      s: { start_ts: number; end_ts: number; text: string; message_count: number }
    ) =>
      invoke<{ archived: number }>(
        IpcChannels.chatHistory.commitCompression,
        characterId,
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
    emitPerformance: (payload: { emotion?: string; motion?: string; characterId?: string; speaking?: boolean }) =>
      mateSync({ type: 'performance', ...payload }),
    emitRuntime: (payload: { runningCharacters: Record<string, boolean>; activeCharacterId: string | null }) =>
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
