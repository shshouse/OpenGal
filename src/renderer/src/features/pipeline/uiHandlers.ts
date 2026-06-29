/**
 * UIWorker 的默认 handler 集合。对齐 RachelForster `core/handlers/ui_message_handler.py`。
 *
 * 当前最小实现：
 * - DefaultDialogUiHandler：把对话片段送到 chatStore + 触发 Live2D 表情 + 通过 model.speak 播放音频
 *
 * 后续（M3 AVG 演出层）会增加：
 * - ChainOfThoughtUiHandler / OptionsUiHandler / BgmUiHandler / SceneUiHandler 等
 */

import type { TTSOutputMessage } from '@shared/messages'
import { applyEmotion, getLive2DModel } from '@/features/live2d/live2dBus'
import { useASRStore } from '@/features/asr/asrStore'
import type { MessageHandler } from './handlerChain'

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

/**
 * 默认对话 handler：处理所有「非系统消息」的演出部分。
 *
 * 注意：streamingSegments 的累积**不在这里**做——它由 `startChatStreamBridge`
 * 在 emit('llm:dialog') 时同步完成。这里只负责"演出"：切表情 + 播放 audio。
 * 这样文本落盘不会被 audio 播放阻塞，避免 finalize 早于 segments 累积。
 *
 * 流程：
 * 1. applyEmotion 切 Live2D 表情
 * 2. 有音频 → model.speak 驱动 lipsync；无音频 → 跳过
 */
export class DefaultDialogUiHandler implements MessageHandler<TTSOutputMessage> {
  canHandle(msg: TTSOutputMessage): boolean {
    return !msg.isSystem
  }

  async handle(msg: TTSOutputMessage): Promise<void> {
    if (msg.emotion) applyEmotion(msg.emotion)

    if (!msg.audioUrl) return

    const wasASRRunning = useASRStore.getState().running
    if (wasASRRunning) await useASRStore.getState().stop()

    const model = getLive2DModel()
    if (model) {
      await new Promise<void>((resolve) => {
        try {
          model.speak(msg.audioUrl, {
            volume: 1,
            crossOrigin: 'anonymous',
            onFinish: () => resolve(),
            onError: (err: Error) => {
              console.warn('[UIWorker] model.speak error', err)
              resolve()
            },
          })
        } catch (err) {
          console.warn('[UIWorker] model.speak threw', err)
          resolve()
        }
      })
    } else {
      await playFallbackAudio(msg.audioUrl)
    }

    if (wasASRRunning) await useASRStore.getState().start()
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
