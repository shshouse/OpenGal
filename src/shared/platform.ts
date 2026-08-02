/**
 * 平台抽象层：定义桌面端 (Electron IPC) 和移动端 (HTTP/本地) 共享的 API 接口。
 *
 * renderer 代码通过 getPlatform() 获取当前平台实现，不直接调用 window.opengal。
 * 桌面端在 preload 注入 electron 实现，移动端在 Capacitor 注入 http 实现。
 */

import type {
  AppConfig,
  IpcResult,
  LLMRequest,
  LLMResponse,
  Live2DModelConfig,
  RoleCardEntry,
  ToolCall,
  ToolDefinition
} from './types'
import type { LogEntry } from './log'

export interface PlatformAPI {
  config: {
    get(): Promise<IpcResult<AppConfig>>
    set(patch: Partial<AppConfig>): Promise<IpcResult<AppConfig>>
  }
  llm: {
    chat(request: LLMRequest): Promise<IpcResult<LLMResponse>>
    chatStream(request: LLMRequest, streamId: string): Promise<IpcResult<unknown>>
    onStreamChunk(listener: (streamId: string, chunk: string) => void): () => void
    onStreamReasoning(listener: (streamId: string, delta: string) => void): () => void
    onStreamDone(listener: (streamId: string) => void): () => void
    onStreamError(listener: (streamId: string, error: string) => void): () => void
    onToolCalls(listener: (streamId: string, calls: ToolCall[]) => void): () => void
    abortStream(streamId: string): Promise<IpcResult<unknown>>
  }
  rag: {
    search(query: string, topK?: number): Promise<IpcResult<unknown[]>>
    reload(): Promise<IpcResult<unknown[]>>
    listFiles(): Promise<IpcResult<string[]>>
    readFile(fileName: string): Promise<IpcResult<string | null>>
  }
  tools: {
    list(): Promise<IpcResult<ToolDefinition[]>>
    execute(name: string, argsJson: string): Promise<IpcResult<{ ok: true; result: string } | { ok: false; error: string }>>
  }
  model: {
    resolveDefault(): Promise<IpcResult<Live2DModelConfig | null>>
    resolveFromCard(cardId: string): Promise<IpcResult<Live2DModelConfig | null>>
    scan(folderPath: string, modelJsonFile: string): Promise<IpcResult<Live2DModelConfig | null>>
  }
  character: {
    list(): Promise<IpcResult<RoleCardEntry[]>>
    get(id: string): Promise<IpcResult<RoleCardEntry | null>>
  }
  pet: {
    open(): Promise<IpcResult<unknown>>
    close(): Promise<IpcResult<unknown>>
    sendBubble(text: string): Promise<IpcResult<unknown>>
    onBubble(listener: (text: string) => void): () => void
  }
  tts: {
    speak(request: { text: string; overrides?: Record<string, unknown> }): Promise<IpcResult<{ audioBase64: string; mimeType: string }>>
    ping(): Promise<IpcResult<{ ok: boolean; message?: string }>>
    reset(): Promise<IpcResult<unknown>>
    serverStart(): Promise<IpcResult<unknown>>
    serverStop(): Promise<IpcResult<unknown>>
    serverStatus(): Promise<IpcResult<unknown>>
    serverLog(): Promise<IpcResult<string>>
  }
  window: {
    minimize(): Promise<void>
    maximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  }
  asr: {
    start(): Promise<IpcResult<unknown>>
    stop(): Promise<IpcResult<unknown>>
    feed(pcm16: ArrayBuffer): void
    status(): Promise<IpcResult<{ running: boolean }>>
    onPartial(listener: (text: string) => void): () => void
    onFinal(listener: (text: string) => void): () => void
  }
  logs: {
    list(): Promise<IpcResult<LogEntry[]>>
    clear(): Promise<IpcResult<unknown>>
    onEntry(listener: (entry: LogEntry) => void): () => void
  }
}

let _platform: PlatformAPI | null = null

export function setPlatform(p: PlatformAPI): void {
  _platform = p
}

export function getPlatform(): PlatformAPI {
  if (!_platform) {
    // ponytail: 自动检测桌面端 preload 注入。移动端必须在 Capacitor 初始化前调用 setPlatform。
    const w = globalThis as unknown as { opengal?: PlatformAPI }
    if (w.opengal) {
      _platform = w.opengal
    } else {
      throw new Error('Platform not initialized. Call setPlatform() before using getPlatform().')
    }
  }
  return _platform
}
