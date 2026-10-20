import { pipelineBus } from './pipelineBus'
import { isTTSBusy } from './ttsWorker'
import { isUIBusy } from './uiWorker'
import { useChatStore } from '@/features/chat/chatStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { cancelDirectorPending } from './directorWorker'

let interruptedAt = 0

export function consumeVoiceInterruption(): boolean {
  const interrupted = interruptedAt > 0 && Date.now() - interruptedAt < 30_000
  interruptedAt = 0
  return interrupted
}

export function startBargeInBridge(): () => void {
  const offSpeech = pipelineBus.on('user:speechStart', () => {
    if (!useChatStore.getState().isSending && !isTTSBusy() && !isUIBusy()) return
    pipelineBus.emit('pipeline:abort', undefined)
    cancelDirectorPending()
    interruptedAt = Date.now()
    useLogsStore.getState().appendLocal('info', 'voice', '检测到用户插话，停止旧回复；继续监听本句')
  })
  const offInput = pipelineBus.on('user:input', () => { interruptedAt = 0; cancelDirectorPending() })
  const offSettings = pipelineBus.on('asr:settingsChanged', cancelDirectorPending)
  return () => { offSpeech(); offInput(); offSettings(); interruptedAt = 0 }
}
