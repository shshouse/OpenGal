import { pipelineBus } from './pipelineBus'
import { evaluateInitiative, takeInitiativeBudget } from './directorWorker'
import { describeAction } from './directorContract'
import { useChatStore } from '@/features/chat/chatStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { resolveInitiativePolicy } from '@shared/initiativePolicy'
import { detectReturn } from './initiativePerception'
import { buildInitiativeNudge } from '@shared/initiativeNudge'
import { speechLanguageLabel } from '@shared/subtitles'
import { useCharacterStore } from '@/features/character/characterStore'
import { useCharacterRuntimeStore } from '@/features/character/characterRuntimeStore'
import { isCharacterRunning } from '@shared/characterRuntime'
import { getErrorMessage } from '@shared/errors'

const TICK_MS = 60_000
/** 主动开口后多久内不再尝试 */
const INITIATIVE_COOLDOWN_MS = 5 * 60_000

function log(level: 'info' | 'warn', message: string): void {
  useLogsStore.getState().appendLocal(level, 'initiative', message)
}

/** 静默达到阈值时交给导演决定是否主动开口 */
export function startInitiative(): () => void {
  let lastActivityAt = Date.now()
  let lastInitiativeAt = 0
  let running = false
  let wasReturned = false

  const off = pipelineBus.on('user:input', (msg) => {
    // 导演与问候自己发出的输入不算用户活动，否则会无限自我重置
    if (msg.source === 'system') return
    lastActivityAt = Date.now()
  })

  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      const cfg = (await window.opengal.config.get()).data?.asr
      if (!cfg) return
      const policy = resolveInitiativePolicy(cfg)
      if (!policy.enabled) return
      const activeId = useCharacterStore.getState().activeId
      if (!isCharacterRunning(useCharacterRuntimeStore.getState().byId, activeId)) return
      if (useChatStore.getState().isSending) return
      const envRes = await window.opengal.env.get()
      const env = envRes.success ? (envRes.data ?? null) : null
      const returned = detectReturn(wasReturned, env)
      wasReturned = returned.wasReturned
      const idleMs = Date.now() - lastActivityAt
      const idleReady = idleMs >= policy.idleMinutes * 60_000
      const returnReady = cfg.directorMode === 'life' && returned.fire
      if (!idleReady && !returnReady) return
      if (lastInitiativeAt && Date.now() - lastInitiativeAt < INITIATIVE_COOLDOWN_MS) return

      const decision = await evaluateInitiative(idleMs)
      if (decision.action.type !== 'speak') {
        log('info', `主动时刻不开口: ${describeAction(decision.action)} / ${decision.reason}`)
        return
      }
      if (!takeInitiativeBudget()) {
        log('info', '主动预算已用尽，本次不开口')
        return
      }

      lastInitiativeAt = Date.now()
      const card = useCharacterStore.getState().list.find((c) => c.id === activeId)
      const languageLabel = card?.language ? speechLanguageLabel(card.language) : null
      const nudge = buildInitiativeNudge(Math.round(idleMs / 60_000), env, cfg.directorMode ?? 'agent', undefined, languageLabel)
      log('info', `主动开口: ${decision.reason}`)
      useChatStore.getState().setSending(true)
      pipelineBus.emit('user:input', { text: nudge, source: 'system', systemPrompt: nudge })
    } catch (err) {
      log('warn', `主动时刻判定失败: ${getErrorMessage(err)}`)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => {
    void tick()
  }, TICK_MS)
  return () => {
    clearInterval(timer)
    off()
  }
}
