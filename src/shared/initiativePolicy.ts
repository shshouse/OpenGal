export interface InitiativeConfig {
  directorEnabled: boolean
  directorMode?: 'agent' | 'life'
  directorInitiativeEnabled: boolean
  directorIdleMinutes: number
}

export interface InitiativePolicy {
  enabled: boolean
  idleMinutes: number
}

/** Life 模式下即使没开主动开关也自己行动，静默阈值默认压到 2 分钟 */
const LIFE_IDLE_MINUTES = 2

export function resolveInitiativePolicy(cfg: InitiativeConfig): InitiativePolicy {
  const configured = Math.max(1, cfg.directorIdleMinutes)
  if (!cfg.directorEnabled) return { enabled: false, idleMinutes: configured }
  if (cfg.directorMode === 'life') {
    return { enabled: true, idleMinutes: Math.min(configured, LIFE_IDLE_MINUTES) }
  }
  return { enabled: cfg.directorInitiativeEnabled, idleMinutes: configured }
}
