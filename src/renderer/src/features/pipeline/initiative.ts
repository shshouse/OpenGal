import { pipelineBus } from './pipelineBus'
import { evaluateInitiative, takeInitiativeBudget } from './directorWorker'
import { describeAction } from './directorContract'
import { useChatStore } from '@/features/chat/chatStore'
import { useLogsStore } from '@/features/logs/logsStore'

const TICK_MS = 60_000
/** 主动开口后多久内不再尝试 */
const INITIATIVE_COOLDOWN_MS = 5 * 60_000

function log(level: 'info' | 'warn', message: string): void {
  useLogsStore.getState().appendLocal(level, 'initiative', message)
}

function timeBucket(now = new Date()): string {
  const h = now.getHours()
  if (h < 6) return '深夜'
  if (h < 9) return '清晨'
  if (h < 12) return '上午'
  if (h < 14) return '中午'
  if (h < 18) return '下午'
  if (h < 23) return '晚上'
  return '深夜'
}

function buildNudge(idleMinutes: number): string {
  return `（你已经注意到对方 ${idleMinutes} 分钟没有理你了。现在是${timeBucket()}。如果你想开口，就用一两句符合你性格的话主动说点什么，自然、简短，不要提到"很久没说话"这类元信息。）`
}

/**
 * 主动时刻调度：固定间隔检查用户是否静默足够久，交给导演决定要不要开口。
 * 配置关闭时只维持计时，不做任何请求。
 */
export function startInitiative(): () => void {
  let lastActivityAt = Date.now()
  let lastInitiativeAt = 0
  let running = false

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
      if (!cfg?.directorInitiativeEnabled || !cfg.directorEnabled) return
      if (useChatStore.getState().isSending) return
      const idleMs = Date.now() - lastActivityAt
      if (idleMs < Math.max(1, cfg.directorIdleMinutes) * 60_000) return
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
      const nudge = buildNudge(Math.round(idleMs / 60_000))
      log('info', `主动开口: ${decision.reason}`)
      useChatStore.getState().setSending(true)
      pipelineBus.emit('user:input', { text: nudge, source: 'system', systemPrompt: nudge })
    } catch (err) {
      log('warn', `主动时刻判定失败: ${(err as Error).message}`)
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
