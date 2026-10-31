export interface TtsVoice {
  id: string
  label: string
  language?: string
}

export interface TtsRequest {
  text: string
  voiceId?: string
  language?: string
  speed?: number
  /** 引擎私有参数，由适配器解释 */
  options?: Record<string, unknown>
}

export interface TtsAudio {
  bytes: Uint8Array
  mimeType: string
}

/** 语音合成端口：桌面 Python 子进程，移动端系统 TTS 或云端。 */
export interface TtsProvider {
  readonly id: string
  listVoices(): Promise<TtsVoice[]>
  synthesize(req: TtsRequest, signal?: AbortSignal): Promise<TtsAudio>
  reset?(): void
}
