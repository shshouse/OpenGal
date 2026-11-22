import type { RoleMode, RoleStateSnapshot } from '../../core/role/types'
import type { ScreenPulse } from '../presence/screen'

export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface RuntimeRoleItem {
  roleId: string
  displayName: string
  mode: RoleMode
  running: boolean
  lifePaused: boolean
  thinking: boolean
  state: RoleStateSnapshot
}

export interface RuntimePoolSnapshot {
  focusedRoleId: string | null
  runningRoleIds: string[]
  roles: Record<string, RuntimeRoleItem>
}

export interface AutonomousSpeakPayload {
  roleId: string
  line: string
  mood: string
  activity: string
  ts: number
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
  /** 屏幕观察打开时才有值；关闭时为 null */
  screen: ScreenPulse | null
}
