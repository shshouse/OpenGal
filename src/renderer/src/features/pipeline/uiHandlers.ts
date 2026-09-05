import type { TTSOutputMessage } from '@shared/messages'
import { applyEmotion, getLive2DModel, playMotionGroup } from '@/features/live2d/live2dBus'
import { useASRStore } from '@/features/asr/asrStore'
import type { MessageHandler } from './handlerChain'
import { pipelineBus } from './pipelineBus'

let fallbackAudio: HTMLAudioElement | null = null

export function stopFallbackAudio(): void {
  if (fallbackAudio) {
    try {
      fallbackAudio.pause()
      fallbackAudio.currentTime = 0
    } catch {
      /* ignore */
    }
    fallbackAudio = null
  }
}

export class DefaultDialogUiHandler implements MessageHandler<TTSOutputMessage> {
  private interrupted = false

  canHandle(msg: TTSOutputMessage): boolean {
    return !msg.isSystem
  }

  async handle(msg: TTSOutputMessage): Promise<void> {
    this.interrupted = false
    if (msg.emotion) applyEmotion(msg.emotion)
    if (msg.motion) playMotionGroup(msg.motion)

    if (!msg.audioUrl) return

    const wasASRRunning = useASRStore.getState().running
    if (wasASRRunning) await useASRStore.getState().stop()

    const model = getLive2DModel()
    if (model) {
      await new Promise<void>((resolve) => {
        const off = pipelineBus.on('user:input', () => {
          this.interrupted = true
          try { model.stopSpeaking() } catch { /* ignore */ }
          resolve()
        })
        try {
          model.speak(msg.audioUrl, {
            volume: 1,
            crossOrigin: 'anonymous',
            onFinish: () => {
              off()
              if (!this.interrupted) resolve()
            },
            onError: (err: Error) => {
              console.warn('[UIWorker] model.speak error', err)
              off()
              resolve()
            },
          })
        } catch (err) {
          console.warn('[UIWorker] model.speak threw', err)
          off()
          resolve()
        }
      })
    } else {
      await playFallbackAudio(msg.audioUrl)
    }

    if (wasASRRunning && !this.interrupted) await useASRStore.getState().start()
  }
}

async function playFallbackAudio(audioUrl: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const audio = new Audio(audioUrl)
    fallbackAudio = audio
    const done = (): void => {
      if (fallbackAudio === audio) fallbackAudio = null
      resolve()
    }
    audio.addEventListener('ended', done)
    audio.addEventListener('error', done)
    audio.play().catch((err) => {
      console.warn('[UIWorker] fallback audio.play rejected', err)
      done()
    })
  })
}
