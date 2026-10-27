import type { PerceptionEvent } from './directorContract'
import type { EnvSnapshot } from '@shared/types'

export function buildInitiativePerception(
  now: number,
  idleMs: number,
  env: EnvSnapshot | null,
): PerceptionEvent[] {
  const events: PerceptionEvent[] = [
    { id: `idle-${now}`, kind: 'idle', at: now, ttlMs: 60_000, trusted: true, sinceMs: idleMs },
  ]
  const foreground = env?.foreground
  if (foreground) {
    events.push({
      id: `app-${now}`,
      kind: 'app',
      at: now,
      ttlMs: 60_000,
      trusted: true,
      name: foreground.app,
      title: foreground.title,
      fullscreen: foreground.fullscreen,
    })
  }
  return events
}

export function detectReturn(
  wasReturned: boolean,
  env: EnvSnapshot | null,
): { fire: boolean; wasReturned: boolean } {
  if (!env) return { fire: false, wasReturned }
  const nowReturned = env.justReturned === true
  return { fire: nowReturned && !wasReturned, wasReturned: nowReturned }
}
