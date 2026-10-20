import type { TTSOutputMessage } from '@shared/messages'
import { applyEmotion, getLive2DModel, playMotionGroup } from '@/features/live2d/live2dBus'
import { useLogsStore } from '@/features/logs/logsStore'
import type { MessageHandler } from './handlerChain'
import { pipelineBus } from './pipelineBus'

let cancelPlayback: (() => void) | null = null

export function stopDialogPlayback(): void { cancelPlayback?.() }

export class DefaultDialogUiHandler implements MessageHandler<TTSOutputMessage> {
  private turnStartedAt = 0
  private lastEmotion = ''
  private firstAudioLogged = false

  canHandle(msg: TTSOutputMessage): boolean {
    return !msg.isSystem
  }

  async handle(msg: TTSOutputMessage): Promise<void> {
    if (msg.turnStartedAt && msg.turnStartedAt !== this.turnStartedAt) {
      this.turnStartedAt = msg.turnStartedAt
      this.lastEmotion = ''
      this.firstAudioLogged = false
    }
    if (msg.emotion && msg.emotion !== this.lastEmotion) {
      this.lastEmotion = msg.emotion
      applyEmotion(msg.emotion)
    }
    if (msg.motion) {
      playMotionGroup(msg.motion)
    }

    if (!msg.audioUrl) {
      pipelineBus.emit('tts:segmentStart', msg)
      return
    }

    if (!this.firstAudioLogged && msg.turnStartedAt) {
      this.firstAudioLogged = true
      useLogsStore
        .getState()
        .appendLocal('info', 'latency', `audioStart +${Math.round(performance.now() - msg.turnStartedAt)}ms`)
    }
    pipelineBus.emit('tts:segmentStart', msg)

    await playDialogAudio(msg.audioUrl)
  }
}

async function playDialogAudio(audioUrl: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const model = getLive2DModel()
    const audio = model ? null : new Audio(audioUrl)
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      if (cancelPlayback === cancel) cancelPlayback = null
      audio?.removeEventListener('ended', done)
      audio?.removeEventListener('error', done)
      resolve()
    }
    const cancel = (): void => {
      done()
      try {
        if (model) model.stopSpeaking()
        if (audio) { audio.pause(); audio.currentTime = 0 }
      } catch { /* 已释放的播放器不影响队列退出 */ }
    }
    cancelPlayback = cancel
    try {
      if (model) {
        model.speak(audioUrl, { volume: 1, crossOrigin: 'anonymous', onFinish: done, onError: done })
      } else if (audio) {
        audio.addEventListener('ended', done)
        audio.addEventListener('error', done)
        void audio.play().catch(done)
      }
    } catch (err) {
      console.warn('[UIWorker] audio playback failed', err)
      done()
    }
  })
}
