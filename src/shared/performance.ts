import type { EmotionTag, PerformanceManifest, RoleCard } from './types'

export interface SpeakRequest {
  text: string
  audioUrl?: string
  emotion?: EmotionTag | string
  action?: string
}

export interface PerformanceBackend {
  readonly kind: 'live2d' | 'sprite'
  load(card: RoleCard, manifest: PerformanceManifest | null): Promise<void>
  applyEmotion(emotion: EmotionTag | string, action?: string): void
  speak(req: SpeakRequest): Promise<void>
  stop(): void
  dispose(): void
}

export function resolvePerformanceMode(
  card: RoleCard,
  available: { live2d: boolean; sprite: boolean },
): 'live2d' | 'sprite' | null {
  const mode = card.performance.mode
  if (mode === 'live2d') return available.live2d ? 'live2d' : null
  if (mode === 'sprite') return available.sprite ? 'sprite' : null
  const order = card.performance.preferred ?? ['live2d', 'sprite']
  for (const candidate of order) {
    if (candidate === 'live2d' && available.live2d) return 'live2d'
    if (candidate === 'sprite' && available.sprite) return 'sprite'
  }
  if (available.live2d) return 'live2d'
  if (available.sprite) return 'sprite'
  return null
}
