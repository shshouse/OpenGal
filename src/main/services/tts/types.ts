import type { RoleCardEntry, TTSConfig } from '@shared/types'

export interface TTSGenerateRequest {
  text: string
  globalConfig: TTSConfig
  card?: RoleCardEntry | null
  overrides?: Partial<TTSConfig>
}

export interface TTSGenerateResponse {
  audioBase64: string
  mimeType: string
  // 模型格式与引擎不匹配等场景：合成被跳过，调用方按无语音处理
  skipped?: boolean
}

export interface TTSAdapter {
  readonly provider: string
  ping(req: { globalConfig: TTSConfig; card?: RoleCardEntry | null }): Promise<{ ok: boolean; message?: string }>
  checkAvailability(req: { globalConfig: TTSConfig; card?: RoleCardEntry | null }): { ok: boolean; reason?: string }
  generateSpeech(req: TTSGenerateRequest): Promise<TTSGenerateResponse>
  reset(): void
}
