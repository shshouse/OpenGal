import type { TTSOutputMessage } from '@shared/messages'
import { applyEmotion, getLive2DModel, playMotionGroup } from '@/features/live2d/live2dBus'
import { useLogsStore } from '@/features/logs/logsStore'
import type { MessageHandler } from './handlerChain'
import { pipelineBus } from './pipelineBus'

let cancelPlayback: (() => void) | null = null
let speakingCount = 0

export function stopDialogPlayback(): void { cancelPlayback?.() }

/** 是否有语音正在播放 */
export function isSpeaking(): boolean {
  return speakingCount > 0
}

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

    // 视觉推进：气泡、字幕、表情、动作都在真实发声时触发，避免声画错位
    const startVisuals = (): void => {
      if (msg.emotion && msg.emotion !== this.lastEmotion) {
        this.lastEmotion = msg.emotion
        applyEmotion(msg.emotion)
      }
      if (msg.motion) {
        playMotionGroup(msg.motion)
      }
      pipelineBus.emit('tts:segmentStart', msg)
    }

    if (!msg.audioUrl) {
      startVisuals()
      return
    }

    await playDialogAudio(msg.audioUrl, () => {
      if (!this.firstAudioLogged && msg.turnStartedAt) {
        this.firstAudioLogged = true
        useLogsStore
          .getState()
          .appendLocal('info', 'latency', `audioStart +${Math.round(performance.now() - msg.turnStartedAt)}ms`)
      }
      startVisuals()
    })
  }
}

// 只在真实播放开始时回调 onStart；取消后不再触发（防止迟到的声画复活旧回复）。
async function playDialogAudio(audioUrl: string, onStart: () => void): Promise<void> {
  await new Promise<void>((resolve) => {
    const model = getLive2DModel()
    const audio = model ? null : new Audio(audioUrl)
    let settled = false
    let started = false
    const start = (): void => {
      if (settled || started) return
      started = true
      speakingCount += 1
      onStart()
    }
    const done = (): void => {
      if (settled) return
      settled = true
      if (started) speakingCount = Math.max(0, speakingCount - 1)
      if (cancelPlayback === cancel) cancelPlayback = null
      audio?.removeEventListener('playing', start)
      audio?.removeEventListener('ended', done)
      audio?.removeEventListener('error', done)
      resolve()
    }
    const cancel = (): void => {
      done()
      try {
        if (model) model.stopSpeaking()
        if (audio) {
          audio.pause()
          audio.currentTime = 0
        }
      } catch {
        /* 已释放的播放器不影响队列退出 */
      }
    }
    cancelPlayback = cancel
    try {
      if (model) {
        // Live2D 库没有 onStart 回调：speak 调用即开始排入播放，紧随其后推进视觉
        model.speak(audioUrl, {
          volume: 1,
          crossOrigin: 'anonymous',
          onFinish: done,
          onError: () => {
            start()
            done()
          },
        })
        start()
      } else if (audio) {
        audio.addEventListener('playing', start)
        audio.addEventListener('ended', done)
        audio.addEventListener('error', () => {
          start()
          done()
        })
        void audio.play().catch(() => {
          start()
          done()
        })
      }
    } catch (err) {
      console.warn('[UIWorker] audio playback failed', err)
      start()
      done()
    }
  })
}
