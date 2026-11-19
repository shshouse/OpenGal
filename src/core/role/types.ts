export type RoleMode = 'agent' | 'life'

export interface RoleExampleTurn {
  user: string
  assistant: string
}

export interface RoleTemplateOrigin {
  id: string
  folder?: string
  version?: string | null
}

export interface RoleStateSnapshot {
  mood: string
  energy: number
  relationshipStage: string
  currentActivity: string
  shortTermGoal: string
  nextTickAt: number | null
  updatedAt: number
}

export interface RoleSummaryMeta {
  lastActiveAt: number
  lastMessagePreview: string
  mood: string
  energy: number
  currentActivity: string
  memoryCount: number
}

export type LifeLogKind = 'thought' | 'action' | 'observation' | 'diary'

export interface LifeLogEntry {
  id: number
  kind: LifeLogKind
  title: string
  content: string
  mood: string | null
  ts: number
}

export function createDefaultRoleState(now = Date.now()): RoleStateSnapshot {
  return {
    mood: 'neutral',
    energy: 85,
    relationshipStage: '初识',
    currentActivity: '待机中',
    shortTermGoal: '',
    nextTickAt: null,
    updatedAt: now,
  }
}

export function createDefaultRoleSummary(now = Date.now()): RoleSummaryMeta {
  return {
    lastActiveAt: now,
    lastMessagePreview: '',
    mood: 'neutral',
    energy: 85,
    currentActivity: '待机中',
    memoryCount: 0,
  }
}
