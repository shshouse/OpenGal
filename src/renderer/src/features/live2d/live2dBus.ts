/**
 * Shared reference to the currently loaded Live2D model, so that non-Live2D
 * modules (e.g. TTS player) can drive it for features like audio lip-sync.
 */

import type { EmotionTag } from '@shared/types'
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
    motionManager?: {
      expressionManager?: {
        setExpression: (name: string) => void
        definitions?: Array<{ Name?: string; File?: string }>
      }
      /** 动作组定义（来自 model3.json 的 Motions），键即动作组名 */
      definitions?: Record<string, unknown>
      startRandomMotion?: (group: string, priority: number) => Promise<boolean>
      /** 当前是否有动作在播（保活巡检与调试钩子用） */
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

/**
 * 模型加载完成时的全身参数快照（一套已知渲染正常的值）。
 * 反应动作播完时整体恢复这套值，清掉动作残留（如黑头套 ParamTK、被冻结的角度）。
 * 用「载入时的真实值」而非 getParameterDefaultValue：后者对 BlendShape 等特殊参数
 * 可能返回 NaN，写入会让整个模型顶点变 NaN 而消失；真实读出的值必然有限且可见。
 */
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

/* ------------------------------------------------------------------------- */
/* 动作播放（点击反应 / LLM 自主动作共用）                                     */
/* ------------------------------------------------------------------------- */

/** 当前已加载模型可用的动作组名列表（来自 model3.json 的 Motions）。 */
export function getAvailableMotionGroups(): string[] {
  const defs = currentModel?.internalModel?.motionManager?.definitions
  return defs ? Object.keys(defs) : []
}

/**
 * 把全身参数恢复到载入时的快照（挂在 motionFinish 上调用）。
 *
 * 动作播放中调用也无害：动作/待机/鼠标跟踪每帧都会重写自己驱动的参数，
 * 复位只影响「没有任何东西在驱动的残留参数」——被打断动作冻结的角度、
 * 动作独有的黑头套 ParamTK 等，这正是要清掉的部分。
 *
 * 注意不能用「播过反应动作才复位」的一次性标记：打断动作时库会立即补发一次
 * motionFinish（把被停的旧动作计为结束），标记被提前消费后，真正的结束反而
 * 漏掉复位——残留就是从这里漏出去的。每次 finish 都复位即可。
 */
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

/**
 * 播放某个动作组里的随机一个动作（FORCE 优先级，允许打断）。
 *
 * 先把参数复位到干净快照再开播（清掉上一个动作的残留），动作结束时由
 * keepIdleAlive 挂的 motionFinish 再复位一次兜底。组名不存在（如 LLM 编造）
 * 时跳过并记日志。点击触发的 'click' 组和 LLM 触发的动作组都走这里。
 */
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
    void mm.startRandomMotion(group, 3).catch(() => {
      // startRandomMotion 拒绝视为可忽略（如动作文件加载失败已被 motionLoadError 记录）
    })
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------------- */
/* 调试钩子（仅 dev）                                                          */
/* ------------------------------------------------------------------------- */

/**
 * dev 下暴露到 window.__opengalLive2D，供 DevTools / CDP 远程检查：
 * 参数完整性（NaN 会让模型消失）、黑头套 ParamTK 残留、动作状态、手动触发动作。
 */
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__opengalLive2D = {
    getMotionGroups: getAvailableMotionGroups,
    playMotionGroup,
    resetPose,
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
        // 模型没有该参数
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
