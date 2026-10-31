import { create } from 'zustand'
import type { BootStep } from '@shared/types'
import { isCharacterRunning } from '@shared/characterRuntime'
import { speechLanguageLabel } from '@shared/subtitles'
import { useCharacterRuntimeStore } from '@/features/character/characterRuntimeStore'
import { useCharacterStore } from '@/features/character/characterStore'
import { useChatStore } from '@/features/chat/chatStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { getErrorMessage } from '@shared/errors'

export type BootPhase = 'booting' | 'waking' | 'awake'

interface StartupState {
  phase: BootPhase
  steps: BootStep[]
  beginBoot: () => void
  reportLive2d: (status: 'ok' | 'failed' | 'skipped', detail?: string) => void
}

const INITIAL_STEPS: BootStep[] = [
  { id: 'live2d', label: 'Live2D 模型', status: 'pending' },
  { id: 'memory', label: '记忆数据库', status: 'pending' },
  { id: 'tts', label: 'TTS 语音服务', status: 'pending' }
]

const WAKE_HOLD_MS = 700
const LIVE2D_TIMEOUT_MS = 20_000
const BOOT_FORCE_WAKE_MS = 30_000

let bootBegan = false
let greeted = false
let greetingPending = false
let llmConfigured = false

function timeBucket(): string {
  const h = new Date().getHours()
  if (h < 5) return '凌晨'
  if (h < 9) return '早上'
  if (h < 12) return '上午'
  if (h < 14) return '中午'
  if (h < 18) return '下午'
  if (h < 23) return '晚上'
  return '深夜'
}

function allSettled(steps: BootStep[]): boolean {
  return steps.every((s) => s.status !== 'pending' && s.status !== 'running')
}

export async function maybeGreet(): Promise<void> {
  if (greeted || greetingPending) return
  const activeId = useCharacterStore.getState().activeId
  if (!isCharacterRunning(useCharacterRuntimeStore.getState().byId, activeId)) return
  greetingPending = true
  try {
    const cfg = await window.opengal.config.get()
    if (!cfg.success || !cfg.data?.startup.greetingEnabled || !llmConfigured) return
    const currentId = useCharacterStore.getState().activeId
    if (currentId !== activeId || !isCharacterRunning(useCharacterRuntimeStore.getState().byId, currentId)) return
    greeted = true
    // 问候语是中文指令，模型容易顺着说中文；角色语言必须在这里再钉一次，
    // 否则中文台词喂给非中文音色模型会被读成参考音频
    const card = useCharacterStore.getState().list.find((c) => c.id === activeId)
    const label = card?.language ? speechLanguageLabel(card.language) : null
    const nudge = `（现在是${timeBucket()}。请用一两句符合角色设定的话向用户打招呼，自然简短，可以结合当前时间，不要提到系统或启动。${label ? `台词必须使用${label}，不要用其他语言。` : ''}）`
    useChatStore.getState().setSending(true)
    pipelineBus.emit('user:input', { text: nudge, source: 'system', systemPrompt: nudge })
  } catch (err) {
    useLogsStore.getState().appendLocal('warn', 'startup', `唤醒问候发送失败: ${getErrorMessage(err)}`)
  } finally {
    greetingPending = false
  }
}

export const useStartupStore = create<StartupState>((set, get) => {
  const wakeIfSettled = (): void => {
    if (get().phase !== 'booting' || !allSettled(get().steps)) return
    set({ phase: 'waking' })
    window.setTimeout(() => {
      set({ phase: 'awake' })
      void maybeGreet()
    }, WAKE_HOLD_MS)
  }

  const applyStep = (step: BootStep): void => {
    set((state) => ({
      steps: state.steps.map((s) => (s.id === step.id ? { ...step } : s))
    }))
    wakeIfSettled()
  }

  return {
    phase: 'booting',
    steps: INITIAL_STEPS,
    beginBoot: () => {
      if (bootBegan) return
      bootBegan = true
      window.opengal.boot.onStep(applyStep)
      void window.opengal.boot.start().then((res) => {
        if (res.success && res.data) {
          llmConfigured = res.data.llmConfigured
          for (const s of res.data.steps) applyStep(s)
        }
      })
      // 模型加载卡死/未配置的兜底：超时按跳过处理，不让她永远睡下去
      window.setTimeout(() => {
        const current = get().steps.find((s) => s.id === 'live2d')
        if (current && (current.status === 'pending' || current.status === 'running')) {
          get().reportLive2d('skipped', '未加载')
        }
      }, LIVE2D_TIMEOUT_MS)
      window.setTimeout(() => {
        if (get().phase !== 'booting') return
        useLogsStore.getState().appendLocal('warn', 'startup', '启动自检超时，按当前可用状态继续')
        set((state) => ({
          steps: state.steps.map((s) =>
            s.status === 'pending' || s.status === 'running'
              ? { ...s, status: 'skipped' as const, detail: '超时' }
              : s
          )
        }))
        wakeIfSettled()
      }, BOOT_FORCE_WAKE_MS)
    },
    reportLive2d: (status, detail) => {
      const cur = get().steps.find((s) => s.id === 'live2d')
      if (!cur) return
      applyStep({ id: 'live2d', label: cur.label, status, detail })
    }
  }
})
