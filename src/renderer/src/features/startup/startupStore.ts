import { create } from 'zustand'
import type { BootStep } from '@shared/types'
import { setEyesClosed } from '@/features/live2d/live2dBus'
import { useChatStore } from '@/features/chat/chatStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { pipelineBus } from '@/features/pipeline'

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

async function maybeGreet(): Promise<void> {
  if (greeted) return
  greeted = true
  try {
    const cfg = await window.opengal.config.get()
    if (!cfg.success || !cfg.data?.startup.greetingEnabled || !llmConfigured) return
    const nudge = `（你刚刚从睡眠中醒来。现在是${timeBucket()}。用一两句符合你性格的话向主人打招呼，自然简短，不要提到系统或启动。）`
    useChatStore.getState().setSending(true)
    pipelineBus.emit('user:input', { text: nudge, source: 'system', systemPrompt: nudge })
  } catch (err) {
    useLogsStore.getState().appendLocal('warn', 'startup', `唤醒问候发送失败: ${(err as Error).message}`)
  }
}

export const useStartupStore = create<StartupState>((set, get) => {
  const wakeIfSettled = (): void => {
    if (get().phase !== 'booting' || !allSettled(get().steps)) return
    set({ phase: 'waking' })
    window.setTimeout(() => {
      set({ phase: 'awake' })
      setEyesClosed(false)
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
      setEyesClosed(true)
      window.opengal.boot.onStep(applyStep)
      void window.opengal.boot.start().then((res) => {
        if (res.success && res.data) {
          llmConfigured = res.data.llmConfigured
          for (const s of res.data.steps) applyStep(s)
        }
      })
      // 模型加载卡死/未配置的兜底：超时按跳过处理，不让她永远睡下去
      window.setTimeout(() => get().reportLive2d('skipped', '未加载'), LIVE2D_TIMEOUT_MS)
      window.setTimeout(() => {
        if (get().phase !== 'booting') return
        useLogsStore.getState().appendLocal('warn', 'startup', '启动自检超时，强制唤醒')
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
      if (get().phase !== 'booting') return
      const cur = get().steps.find((s) => s.id === 'live2d')
      if (!cur || (cur.status !== 'pending' && cur.status !== 'running')) return
      applyStep({ id: 'live2d', label: cur.label, status, detail })
    }
  }
})
