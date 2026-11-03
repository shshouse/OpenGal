export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export type BootStepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped'

export interface BootStep {
  id: 'live2d' | 'memory' | 'tts'
  label: string
  status: BootStepStatus
  detail?: string
}

export interface BootResult {
  steps: BootStep[]
  llmConfigured: boolean
}

export interface EnvSnapshot {
  timeText: string
  idleSeconds: number
  justReturned: boolean
  awayMinutes: number
  game: { name: string; fullscreen: boolean } | null
  foreground: { app: string; title: string; fullscreen: boolean } | null
}
