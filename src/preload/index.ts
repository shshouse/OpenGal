import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type {
  AppConfig,
  ChatMessage,
  IpcResult,
  LLMRequest,
  LLMResponse,
  Live2DModelConfig,
  PluginInfo,
  RoleCardEntry,
  ToolCall,
  ToolDefinition
} from '@shared/types'
import type { LogEntry } from '@shared/log'

function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>
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
    onStreamChunk: (listener: (streamId: string, chunk: string) => void) => {
      const handler = (_: unknown, id: string, chunk: string) => listener(id, chunk)
      ipcRenderer.on(IpcChannels.llm.streamChunk, handler)
      return () => ipcRenderer.off(IpcChannels.llm.streamChunk, handler)
    },
    onStreamReasoning: (listener: (streamId: string, delta: string) => void) => {
      const handler = (_: unknown, id: string, delta: string) => listener(id, delta)
      ipcRenderer.on(IpcChannels.llm.streamReasoning, handler)
      return () => ipcRenderer.off(IpcChannels.llm.streamReasoning, handler)
    },
    onStreamDone: (listener: (streamId: string) => void) => {
      const handler = (_: unknown, id: string) => listener(id)
      ipcRenderer.on(IpcChannels.llm.streamDone, handler)
      return () => ipcRenderer.off(IpcChannels.llm.streamDone, handler)
    },
    onStreamError: (listener: (streamId: string, error: string) => void) => {
      const handler = (_: unknown, id: string, error: string) => listener(id, error)
      ipcRenderer.on(IpcChannels.llm.streamError, handler)
      return () => ipcRenderer.off(IpcChannels.llm.streamError, handler)
    },
    onToolCalls: (listener: (streamId: string, calls: ToolCall[]) => void) => {
      const handler = (_: unknown, id: string, calls: ToolCall[]) => listener(id, calls)
      ipcRenderer.on(IpcChannels.llm.streamToolCalls, handler)
      return () => ipcRenderer.off(IpcChannels.llm.streamToolCalls, handler)
    },
    abortStream: (streamId: string) => invoke(IpcChannels.llm.streamAbort, streamId)
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
    save: (characterId: string, messages: ChatMessage[]) =>
      invoke<boolean>(IpcChannels.chatHistory.save, characterId, messages),
    clear: (characterId: string) => invoke<boolean>(IpcChannels.chatHistory.clear, characterId)
  },
  pet: {
    open: () => invoke(IpcChannels.pet.open),
    close: () => invoke(IpcChannels.pet.close),
    sendBubble: (text: string) => invoke(IpcChannels.pet.bubble, text),
    onBubble: (listener: (text: string) => void) => {
      const handler = (_: unknown, text: string) => listener(text)
      ipcRenderer.on('pet:bubble', handler)
      return () => ipcRenderer.off('pet:bubble', handler)
    }
  },
  tts: {
    speak: (request: { text: string; overrides?: Record<string, unknown> }) =>
      invoke<{ audioBase64: string; mimeType: string }>(IpcChannels.tts.speak, request),
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
  director: {
    log: (entry: Record<string, unknown>) => {
      ipcRenderer.send(IpcChannels.director.log, entry)
    }
  },
  logs: {
    list: () => invoke<LogEntry[]>(IpcChannels.logs.list),
    clear: () => invoke(IpcChannels.logs.clear),
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
