export type ASRResultCallback = (text: string, partial: boolean) => void

export interface ASREngine {
  start(): Promise<void>
  stop(): void
  feed(pcm16: Buffer): void
  isRunning(): boolean
  setResultCallback(cb: ASRResultCallback | null): void
}

export type ASREngineKind = 'sherpa'
