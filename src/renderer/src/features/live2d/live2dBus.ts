/**
 * Shared reference to the currently loaded Live2D model, so that non-Live2D
 * modules (e.g. TTS player) can drive it for features like audio lip-sync.
 */

import type { EmotionTag } from '@shared/types'

export interface Live2DSpeakOptions {
  volume?: number
  crossOrigin?: string
  onFinish?: () => void
  onError?: (err: Error) => void
}

export interface Live2DLike {
  speak: (sound: string, options?: Live2DSpeakOptions) => void
  stopSpeaking: () => void
  expression?: (name: string) => void
  motion?: (group: string, index?: number) => void
  internalModel?: {
    motionManager?: {
      expressionManager?: {
        setExpression: (name: string) => void
        definitions?: Array<{ Name?: string; File?: string }>
      }
    }
    coreModel?: {
      setParameterValueById?: (id: string, value: number) => void
    }
  }
}

let currentModel: Live2DLike | null = null

export function registerLive2DModel(model: Live2DLike | null): void {
  currentModel = model
}

export function getLive2DModel(): Live2DLike | null {
  return currentModel
}

const EMOTION_EXPRESSION_MAP: Record<string, string[]> = {
  neutral: ['neutral', 'normal', 'default', 'Neutral'],
  happy: ['happy', 'smile', 'joy', 'Happy', 'Smile'],
  sad: ['sad', 'cry', 'Sad', 'Cry'],
  angry: ['angry', 'anger', 'Angry'],
  surprised: ['surprised', 'surprise', 'shock', 'Surprised'],
  shy: ['shy', 'blush', 'embarrassed', 'Shy'],
  proud: ['proud', 'smug', 'Proud'],
  thinking: ['thinking', 'think', 'Thinking'],
  sleepy: ['sleepy', 'sleep', 'tired', 'Sleepy'],
  relaxed: ['relaxed', 'calm', 'Relaxed'],
  excited: ['excited', 'hype', 'Excited'],
  worried: ['worried', 'worry', 'nervous', 'Worried']
}

export function applyEmotion(emotion: EmotionTag | string): void {
  const model = currentModel
  if (!model) return

  const expressionManager = model.internalModel?.motionManager?.expressionManager
  if (!expressionManager) return

  const definitions = expressionManager.definitions ?? []
  const availableNames = definitions
    .map((d) => d.Name ?? d.File?.replace(/\.exp3?\.json$/i, '') ?? '')
    .filter(Boolean)

  if (!availableNames.length) return

  const candidates = EMOTION_EXPRESSION_MAP[emotion] ?? [emotion]
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase()
    const match = availableNames.find((n) => n.toLowerCase() === lower)
    if (match) {
      expressionManager.setExpression(match)
      return
    }
  }

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase()
    const partial = availableNames.find((n) => n.toLowerCase().includes(lower))
    if (partial) {
      expressionManager.setExpression(partial)
      return
    }
  }
}
