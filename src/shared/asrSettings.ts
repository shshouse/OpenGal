import type { ASRConfig } from './types'

export function needsASRRestart(previous: ASRConfig | null, next: ASRConfig): boolean {
  if (!previous) return true
  return (['engine', 'modelPath', 'language', 'sampleRate', 'deviceId', 'vadSilenceMs'] as const)
    .some((key) => previous[key] !== next[key]) || JSON.stringify(previous.hotwords) !== JSON.stringify(next.hotwords)
}
