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

    // 视觉推进：气泡、字幕、表情都在真实发声时触发，避免声画错位
    const startVisuals = (): void => {
      if (msg.emotion && msg.emotion !== this.lastEmotion) {
        this.lastEmotion = msg.emotion
        applyEmotion(msg.emotion)
      }
      // 同一次表演同步给桌宠，主窗口与桌宠不会出现两套情绪
      window.opengal.pet?.emitPerformance?.({
        emotion: msg.emotion,
        motion: msg.motion,
        characterId: msg.characterId,
      })
      pipelineBus.emit('tts:segmentStart', msg)
    }

    // 动作必须先于语音：lipsync 补丁的 FORCE 动作会 dispose 正在播放的音频
    if (msg.motion) playMotionGroup(msg.motion)

    if (!msg.audioUrl) {
      startVisuals()
      return
    }

    await playDialogAudio(msg.audioUrl, msg.characterId, () => {
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
async function playDialogAudio(audioUrl: string, characterId: string | undefined, onStart: () => void): Promise<void> {
  await new Promise<void>((resolve) => {
    const model = getLive2DModel()
    let audio: HTMLAudioElement | null = null
    let settled = false
    let started = false
    const start = (): void => {
      if (settled || started) return
      started = true
      speakingCount += 1
      pipelineBus.emit('tts:playback', { speaking: true, characterId })
      window.opengal.pet?.emitPerformance?.({ speaking: true, characterId })
      onStart()
    }
    const onPlaying = (): void => start()
    const onEnded = (): void => done()
    const onError = (): void => {
      start()
      done()
    }
    const done = (): void => {
      if (settled) return
      settled = true
      if (started) {
        speakingCount = Math.max(0, speakingCount - 1)
        pipelineBus.emit('tts:playback', { speaking: false, characterId })
        window.opengal.pet?.emitPerformance?.({ speaking: false, characterId })
      }
      if (cancelPlayback === cancel) cancelPlayback = null
      audio?.removeEventListener('playing', onPlaying)
      audio?.removeEventListener('ended', onEnded)
      audio?.removeEventListener('error', onError)
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
    // 回退路径：不经过 Live2D（没有口型同步，但保证有声音且必定回调）
    const playElement = (): void => {
      const el = new Audio(audioUrl)
      audio = el
      el.addEventListener('playing', onPlaying)
      el.addEventListener('ended', onEnded)
      el.addEventListener('error', onError)
      void el.play().catch(() => {
        start()
        done()
      })
    }
    cancelPlayback = cancel
    if (!model) {
      playElement()
      return
    }
    try {
      // Live2D 库没有 onStart 回调：speak 调用即开始排入播放，紧随其后推进视觉
      const ret = model.speak(audioUrl, {
        volume: 1,
        crossOrigin: 'anonymous',
        onFinish: done,
        onError: () => {
          start()
          done()
        },
      })
      start()
      // 库拒绝播放时返回 false 且不触发任何回调（通常是上一段音频被动作销毁后留下的
      // currentAudio），清掉残留后回退到独立 audio，否则整条播放队列会永久卡住
      void Promise.resolve(ret)
        .then((ok) => {
          if (ok !== false || settled) return
          try {
            model.stopSpeaking()
          } catch {
            /* 残留音频释放失败不影响回退 */
          }
          playElement()
        })
        .catch(() => {})
    } catch (err) {
      console.warn('[UIWorker] audio playback failed', err)
      start()
      done()
    }
  })
}
