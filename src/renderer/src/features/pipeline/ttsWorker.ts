import type { LLMDialogMessage, TTSOutputMessage } from '@shared/messages'
import { useLogsStore } from '@/features/logs/logsStore'
import { pipelineBus } from './pipelineBus'

let bound = false
let unsubscribers: Array<() => void> = []
let queue: Array<LLMDialogMessage> = []
let processing = false
let hasWarnedThisSession = false
let lastWarnedMessage = ''

function reportTTSError(message: string): void {
  if (hasWarnedThisSession && message === lastWarnedMessage) return
  hasWarnedThisSession = true
  lastWarnedMessage = message
  useLogsStore.getState().appendLocal('warn', 'tts-worker', `语音合成失败: ${message}`)
}

function clearQueue(): void {
  queue = []
  useLogsStore.getState().appendLocal('info', 'tts-worker', 'TTS 队列已清空')
}

export function startTTSWorker(): () => void {
  if (bound) return stopTTSWorker
  bound = true

  const offDialog = pipelineBus.on('llm:dialog', (msg) => {
    queue.push(msg)
    void drainQueue()
  })

  const offAbort = pipelineBus.on('pipeline:abort', () => {
    clearQueue()
    processing = false
  })

  const offUserInput = pipelineBus.on('user:input', () => {
    clearQueue()
  })

  unsubscribers = [offDialog, offAbort, offUserInput]
  return stopTTSWorker
}

export function stopTTSWorker(): void {
  for (const off of unsubscribers) off()
  unsubscribers = []
  bound = false
  queue = []
  processing = false
}

async function drainQueue(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (queue.length > 0) {
      const msg = queue.shift()!
      const out = await synthesize(msg)
      pipelineBus.emit('tts:output', out)
      if (!out.audioUrl && out.text) {
        await sleepSilentSegment(out.text)
      }
    }
  } finally {
    processing = false
  }
}

function sleepSilentSegment(text: string): Promise<void> {
  const estimated = Math.min(12000, Math.max(1800, text.length * 250))
  return new Promise((resolve) => setTimeout(resolve, estimated))
}

async function synthesize(msg: LLMDialogMessage): Promise<TTSOutputMessage> {
  const speech = (msg.translate || msg.text || '').trim()
  if (!speech) {
    return {
      audioUrl: '',
      name: msg.name,
      text: msg.text || '',
      assetId: msg.assetId ?? '-1',
      emotion: msg.emotion,
      motion: msg.motion,
      effect: msg.effect,
      isSystem: false,
      isFinalSegment: true,
    }
  }

  let audioUrl = ''
  try {
    const result = await window.opengal.tts.speak({ text: speech })
    if (result.success && result.data) {
      audioUrl = `data:${result.data.mimeType};base64,${result.data.audioBase64}`
      hasWarnedThisSession = false
    } else if (result.error && !/disabled/i.test(result.error)) {
      reportTTSError(result.error)
    }
  } catch (err) {
    reportTTSError((err as Error).message)
  }

  return {
    audioUrl,
    name: msg.name,
    text: msg.text,
    assetId: msg.assetId ?? '-1',
    emotion: msg.emotion,
    motion: msg.motion,
    effect: msg.effect,
    isSystem: false,
    isFinalSegment: true,
  }
}
