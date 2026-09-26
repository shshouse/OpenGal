import type { EmotionTag } from '@shared/types'
import { wakeEyeOpen } from '@shared/wake'
import { useLogsStore } from '@/features/logs/logsStore'

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
    on?: (event: string, cb: (...args: unknown[]) => void) => void
    off?: (event: string, cb: (...args: unknown[]) => void) => void
    motionManager?: {
      expressionManager?: {
        setExpression: (name: string) => void
        definitions?: Array<{ Name?: string; File?: string }>
      }
      definitions?: Record<string, unknown>
      startRandomMotion?: (group: string, priority: number) => Promise<boolean>
      isFinished?: () => boolean
    }
    coreModel?: {
      setParameterValueById?: (id: string, value: number) => void
      getParameterValueById?: (id: string) => number
      getParameterCount?: () => number
      getParameterValueByIndex?: (index: number) => number
      setParameterValueByIndex?: (index: number, value: number) => void
    }
  }
}

let currentModel: Live2DLike | null = null

let initialPose: number[] | null = null

function capturePose(model: Live2DLike | null): number[] | null {
  const core = model?.internalModel?.coreModel
  if (!core?.getParameterCount || !core.getParameterValueByIndex) return null
  try {
    const count = core.getParameterCount()
    if (!count || count <= 0) return null
    const values: number[] = []
    for (let i = 0; i < count; i++) {
      const v = core.getParameterValueByIndex(i)
      values.push(Number.isFinite(v) ? v : 0)
    }
    return values
  } catch {
    return null
  }
}

export function registerLive2DModel(model: Live2DLike | null): void {
  currentModel = model
  initialPose = capturePose(model)
  eyeDriving = false
  if (model && eyesClosed) attachEyes(model.internalModel)
}

// 睡眠态：每帧渲染前把眼睑参数压到 0；唤醒态：按 smoothstep 从 0 插值到 1，写满后自卸载交还眨眼
// 参数 id 因模型而异（Cubism4: ParamEyeLOpen；旧模: PARAM_EYE_L_OPEN），优先用模型自带的 EyeBlink 组
let eyesClosed = false
let eyeDriving = false
let wakeStartMs = 0

function eyeParamIds(model: Live2DLike): string[] {
  const im = model.internalModel as { eyeBlinkIds?: string[] } | undefined
  if (im?.eyeBlinkIds?.length) return im.eyeBlinkIds
  return ['ParamEyeLOpen', 'ParamEyeROpen', 'PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN']
}

function attachEyes(internal: Live2DLike['internalModel']): void {
  if (eyeDriving) return
  internal?.on?.('beforeModelUpdate', driveEyes)
  eyeDriving = true
}

function detachEyes(internal: Live2DLike['internalModel']): void {
  if (!eyeDriving) return
  internal?.off?.('beforeModelUpdate', driveEyes)
  eyeDriving = false
}

const driveEyes = (): void => {
  const model = currentModel
  const core = model?.internalModel?.coreModel
  if (!model || !core?.setParameterValueById) return
  let v = 0
  if (!eyesClosed) {
    v = wakeEyeOpen(wakeStartMs, performance.now())
    if (v >= 1) detachEyes(model.internalModel)
  }
  for (const id of eyeParamIds(model)) {
    try {
      core.setParameterValueById(id, v)
    } catch {
      // 模型缺该参数时忽略
    }
  }
}

export function setEyesClosed(closed: boolean): void {
  if (eyesClosed === closed) return
  eyesClosed = closed
  const internal = currentModel?.internalModel
  if (closed) {
    attachEyes(internal)
    driveEyes()
  } else {
    wakeStartMs = performance.now()
    attachEyes(internal)
  }
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

export function getAvailableMotionGroups(): string[] {
  const defs = currentModel?.internalModel?.motionManager?.definitions
  return defs ? Object.keys(defs) : []
}

export function resetPose(): void {
  const core = currentModel?.internalModel?.coreModel
  if (!core?.setParameterValueByIndex || !initialPose) return
  for (let i = 0; i < initialPose.length; i++) {
    try {
      core.setParameterValueByIndex(i, initialPose[i])
    } catch {
      // ignore
    }
  }
}

export function playMotionGroup(group: string): void {
  const model = currentModel
  const mm = model?.internalModel?.motionManager
  if (!model || !mm?.startRandomMotion) return
  const defs = mm.definitions
  if (defs && !(group in defs)) {
    useLogsStore
      .getState()
      .appendLocal('warn', 'live2d', `LLM 请求了不存在的动作组: ${group}（可用: ${Object.keys(defs).join(', ')}）`)
    return
  }
  console.log('[live2d] 播放动作组:', group)
  useLogsStore.getState().appendLocal('info', 'live2d', `播放动作组: ${group}`)
  resetPose()
  try {
    void mm.startRandomMotion(group, 3).catch(() => {})
  } catch {
    // ignore
  }
}


if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__opengalLive2D = {
    getMotionGroups: getAvailableMotionGroups,
    playMotionGroup,
    resetPose,
    setEyesClosed,
    eyeDebug: (): Record<string, unknown> | null => {
      const model = currentModel
      const im = model?.internalModel as { _events?: Record<string, unknown> } | undefined
      const lst = im?._events?.['beforeModelUpdate']
      return {
        eyesClosed,
        listenerCount: lst ? (Array.isArray(lst) ? lst.length : 1) : 0,
        ids: model ? eyeParamIds(model) : null
      }
    },
    eyeState: (): Record<string, number> | null => {
      const model = currentModel
      const core = model?.internalModel?.coreModel
      if (!model || !core?.getParameterValueById) return null
      const out: Record<string, number> = {}
      for (const id of eyeParamIds(model)) {
        try {
          out[id] = Math.round((core.getParameterValueById(id) ?? -1) * 100) / 100
        } catch {
          out[id] = -1
        }
      }
      return out
    },
    paramStats: (): Record<string, number | boolean | string[] | null> | null => {
      const core = currentModel?.internalModel?.coreModel
      if (!core?.getParameterCount || !core.getParameterValueByIndex) return null
      const count = core.getParameterCount()
      let nonFinite = 0
      for (let i = 0; i < count; i++) {
        if (!Number.isFinite(core.getParameterValueByIndex(i))) nonFinite++
      }
      let paramTK: number | undefined
      try {
        paramTK = core.getParameterValueById?.('ParamTK')
      } catch {
      }
      return {
        paramCount: count,
        nonFinite,
        paramTK: paramTK ?? null,
        isFinished: currentModel?.internalModel?.motionManager?.isFinished?.() ?? null,
        motionGroups: getAvailableMotionGroups(),
      }
    },
  }
}
