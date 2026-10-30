import { startLLMWorker, stopLLMWorker, setGlobalContextWindow } from './llmWorker'
import { setActiveRoleCard } from './activeCard'
import { startTTSWorker, stopTTSWorker } from './ttsWorker'
import { startUIWorker, stopUIWorker } from './uiWorker'
import { startInitiative } from './initiative'
import { setDirectorBudget } from './directorWorker'
import { startMemoryService } from '@/features/memory/memoryService'
import { pipelineBus } from './pipelineBus'
import { useChatStore } from '@/features/chat/chatStore'
import { startASRBridge } from '@/features/asr/asrStore'
import { startSubtitleWorker, useSubtitleStore } from './subtitles'
import { subtitleText } from '@shared/subtitles'
import { startBargeInBridge } from './bargeIn'
import { startActivityBridge } from '@/features/activity/activityBridge'
import { useLogsStore } from '@/features/logs/logsStore'

export { pipelineBus, setActiveRoleCard }
export type { MessageHandler } from './handlerChain'
export { HandlerChain } from './handlerChain'

function summarize(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  const text = record.text ?? record.content ?? record.error
  if (typeof text === 'string') return text.slice(0, 120)
  const keys = Object.keys(record)
  return keys.length > 0 ? keys.join(',') : undefined
}

function installPipelineTrace(): () => void {
  const forced = typeof localStorage !== 'undefined' && localStorage.getItem('opengal:trace') === '1'
  if (!import.meta.env.DEV && !forced) return () => {}
  pipelineBus.setTracer(({ event, payload, listeners }) => {
    useLogsStore.getState().appendLocal(
      'debug',
      'pipeline',
      `${event} · ${listeners} listeners`,
      summarize(payload),
    )
  })
  return () => pipelineBus.setTracer(null)
}

export interface PipelineHandle {
  dispose: () => void
  abort: () => void
}

function startChatStreamBridge(): () => void {
  const off = pipelineBus.on('llm:dialog', (msg) => {
    useChatStore.getState().appendStreamingSegment({
      item: {
        text: msg.text,
        emotion: msg.emotion,
        action: msg.effect,
      },
    })
  })
  return off
}

// 气泡跟音频段走：文字和语音同时出现；聊天记录仍按 LLM 流即时追加
function startPetBubbleBridge(): () => void {
  let text = ''
  let last = ''
  let shown: Array<{ id: string; text: string }> = []
  const push = (): void => {
    const state = useSubtitleStore.getState()
    const segments = shown.map((s) => state.records.flatMap((r) => r.segments).find((item) => item.id === s.id) ?? s)
    const t = (segments.length ? subtitleText(segments, state.preferences.mode) : text).trim()
    if (!t || t === last) return
    last = t
    window.opengal.pet.setBubble(t)
  }
  const offSegment = pipelineBus.on('tts:segmentStart', (msg) => {
    text += msg.text
    shown.push({ id: msg.segmentId ?? '', text: msg.text })
    push()
  })
  const reset = (): void => {
    text = ''
    last = ''
    shown = []
    window.opengal.pet.setBubble('')
  }
  const offUser = pipelineBus.on('user:input', reset)
  const offAbort = pipelineBus.on('pipeline:abort', reset)
  const offTranslation = useSubtitleStore.subscribe(push)
  return () => {
    offTranslation()
    offSegment()
    offUser()
    offAbort()
  }
}

export function startPipeline(): PipelineHandle {
  const stopTrace = installPipelineTrace()
  const stopSubtitles = startSubtitleWorker()
  const stopActivity = startActivityBridge()
  void window.opengal.config.get().then((res) => {
    const cw = res.data?.llm?.contextWindow
    if (typeof cw === 'number' && cw > 0) setGlobalContextWindow(cw)
    const asr = res.data?.asr
    if (asr) setDirectorBudget(asr.directorInitiativePerHour, asr.directorCooldownSec * 1000)
  })
  startLLMWorker()
  startTTSWorker()
  startUIWorker()
  const stopBargeIn = startBargeInBridge()
  const stopMemory = startMemoryService()
  const stopBridge = startChatStreamBridge()
  const stopASR = startASRBridge()
  const stopPetBubble = startPetBubbleBridge()
  const stopInitiative = startInitiative()
  return {
    dispose: () => {
      stopTrace()
      stopActivity()
      stopInitiative()
      stopBargeIn()
      stopSubtitles()
      stopPetBubble()
      stopASR()
      stopBridge()
      stopMemory()
      stopLLMWorker()
      stopTTSWorker()
      stopUIWorker()
    },
    abort: () => {
      pipelineBus.emit('pipeline:abort', undefined)
    },
  }
}
