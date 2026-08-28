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
}

export interface TTSAdapter {
  readonly provider: string
  ping(req: { globalConfig: TTSConfig }): Promise<{ ok: boolean; message?: string }>
  generateSpeech(req: TTSGenerateRequest): Promise<TTSGenerateResponse>
  reset(): void
}
