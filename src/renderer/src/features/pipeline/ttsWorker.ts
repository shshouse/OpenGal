import type { LLMDialogMessage, TTSOutputMessage } from '@shared/messages'
import { useLogsStore } from '@/features/logs/logsStore'
import { pipelineBus } from './pipelineBus'

let bound = false
let unsubscribers: Array<() => void> = []
let queue: Array<LLMDialogMessage> = []
let processing = false
// 代次：abort/新输入时自增，作废旧 drain 循环的在途结果，避免外部直接改写 processing 造成双 drain
let drainGen = 0
let hasWarnedThisSession = false
let lastWarnedMessage = ''
let tracedTurn = 0
let firstTtsStartLogged = false
let firstTtsEndLogged = false

function logLatency(stage: string, start: number): void {
  useLogsStore
    .getState()
    .appendLocal('info', 'latency', `${stage} +${Math.round(performance.now() - start)}ms`)
}

function reportTTSError(message: string): void {
  if (hasWarnedThisSession && message === lastWarnedMessage) return
  hasWarnedThisSession = true
  lastWarnedMessage = message
  useLogsStore.getState().appendLocal('warn', 'tts-worker', `语音合成失败: ${message}`)
}

function clearQueue(): void {
  queue = []
  cancelSilentSleep()
  useLogsStore.getState().appendLocal('info', 'tts-worker', 'TTS 队列已清空')
}

export function isTTSBusy(): boolean { return processing || queue.length > 0 }

export function startTTSWorker(): () => void {
  if (bound) return stopTTSWorker
  bound = true

  const offDialog = pipelineBus.on('llm:dialog', (msg) => {
    queue.push(msg)
    void drainQueue()
  })

  const offAbort = pipelineBus.on('pipeline:abort', () => {
    clearQueue()
    drainGen++
    void window.opengal.tts.cancel().catch(() => {})
  })

  const offUserInput = pipelineBus.on('user:input', () => {
    clearQueue()
    drainGen++
    void window.opengal.tts.cancel().catch(() => {})
  })

  unsubscribers = [offDialog, offAbort, offUserInput]
  return stopTTSWorker
}

export function stopTTSWorker(): void {
  drainGen++
  queue = []
  cancelSilentSleep()
  void window.opengal.tts.cancel().catch(() => {})
  for (const off of unsubscribers) off()
  unsubscribers = []
  bound = false
}

async function drainQueue(): Promise<void> {
  if (processing) return
  processing = true
  const gen = drainGen
  try {
    while (queue.length > 0) {
      if (gen !== drainGen) return
      const msg = queue.shift()!
      if (msg.turnStartedAt && msg.turnStartedAt !== tracedTurn) {
        tracedTurn = msg.turnStartedAt
        firstTtsStartLogged = false
        firstTtsEndLogged = false
      }
      if (!firstTtsStartLogged && msg.turnStartedAt) {
        firstTtsStartLogged = true
        logLatency('ttsStart', msg.turnStartedAt)
      }
      const out = await synthesize(msg)
      if (!firstTtsEndLogged && msg.turnStartedAt) {
        firstTtsEndLogged = true
        logLatency('ttsEnd', msg.turnStartedAt)
      }
      if (gen !== drainGen) return // 已被 abort/新输入作废：在途结果丢弃
      pipelineBus.emit('tts:output', out)
      if (!out.audioUrl && out.text) {
        await sleepSilentSegment(out.text)
      }
    }
  } finally {
    processing = false
    // 旧循环被作废退出时，接管其间新到的队列项
    if (queue.length > 0) void drainQueue()
  }
}

let silentTimer: ReturnType<typeof setTimeout> | null = null
let silentResolve: (() => void) | null = null

function sleepSilentSegment(text: string): Promise<void> {
  const estimated = Math.min(12000, Math.max(1800, text.length * 250))
  return new Promise((resolve) => {
    silentResolve = resolve
    silentTimer = setTimeout(() => {
      silentTimer = null
      silentResolve = null
      resolve()
    }, estimated)
  })
}

function cancelSilentSleep(): void {
  if (silentTimer) clearTimeout(silentTimer)
  silentTimer = null
  const resolve = silentResolve
  silentResolve = null
  resolve?.()
}

async function synthesize(msg: LLMDialogMessage): Promise<TTSOutputMessage> {
  const speech = (msg.text || '').trim()
  if (!speech) {
    return {
      segmentId: msg.segmentId,
      characterId: msg.characterId,
      audioUrl: '',
      name: msg.name,
      text: msg.text || '',
      assetId: msg.assetId ?? '-1',
      emotion: msg.emotion,
      motion: msg.motion,
      effect: msg.effect,
      isSystem: false,
      isFinalSegment: true,
      turnStartedAt: msg.turnStartedAt,
    }
  }

  let audioUrl = ''
  try {
    const result = await window.opengal.tts.speak({ text: speech, roleCardId: msg.characterId })
    if (result.success && result.data) {
      if (!result.data.skipped) {
        audioUrl = `data:${result.data.mimeType};base64,${result.data.audioBase64}`
      }
      hasWarnedThisSession = false
    } else if (result.error && !/disabled/i.test(result.error)) {
      reportTTSError(result.error)
    }
  } catch (err) {
    reportTTSError((err as Error).message)
  }

  return {
    segmentId: msg.segmentId,
    characterId: msg.characterId,
    audioUrl,
    name: msg.name,
    text: msg.text,
    assetId: msg.assetId ?? '-1',
    emotion: msg.emotion,
    motion: msg.motion,
    effect: msg.effect,
    isSystem: false,
    isFinalSegment: true,
    turnStartedAt: msg.turnStartedAt,
  }
}
