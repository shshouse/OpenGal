export interface SttOptions {
  language?: string
  sampleRate: number
  interim: boolean
}

export type SttEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'speech-start' }
  | { type: 'error'; message: string }

export interface SttSession {
  feed(pcm: Uint8Array): void
  finish(): Promise<void>
  cancel(): void
  on(listener: (event: SttEvent) => void): () => void
}

/** 语音识别端口：桌面 sherpa，移动端系统 STT 或云端。 */
export interface SttProvider {
  readonly id: string
  start(options: SttOptions): Promise<SttSession>
  transcribeFile?(bytes: Uint8Array, mimeType: string): Promise<string>
}
