export interface InitiativeConfig {
  directorEnabled: boolean
  directorInitiativeEnabled: boolean
  directorIdleMinutes: number
}

export interface InitiativePolicy {
  enabled: boolean
  idleMinutes: number
}

export function resolveInitiativePolicy(cfg: InitiativeConfig): InitiativePolicy {
  const configured = Math.max(1, cfg.directorIdleMinutes)
  if (!cfg.directorEnabled) return { enabled: false, idleMinutes: configured }
  return { enabled: cfg.directorInitiativeEnabled, idleMinutes: configured }
}
