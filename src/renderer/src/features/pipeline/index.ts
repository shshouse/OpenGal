/**
 * 流水线总入口：在 App 启动时调用 `startPipeline`，拆卸时调用返回的 dispose。
 *
 * 三段流水线对应 RachelForster：
 *   user input ──> [LLMWorker] ──> llm:dialog ──> [TTSWorker] ──> tts:output ──> [UIWorker]
 */

import { startLLMWorker, stopLLMWorker, setActiveRoleCard } from './llmWorker'
import { startTTSWorker, stopTTSWorker } from './ttsWorker'
import { startUIWorker, stopUIWorker } from './uiWorker'
import { pipelineBus } from './pipelineBus'
import { useChatStore } from '@/features/chat/chatStore'
import { startASRBridge } from '@/features/asr/asrStore'

export { pipelineBus, setActiveRoleCard }
export type { MessageHandler } from './handlerChain'
export { HandlerChain } from './handlerChain'

export interface PipelineHandle {
  dispose: () => void
  abort: () => void
}

/**
 * 把 LLM 输出的对话片段**同步**累积进 chatStore。
 *
 * 必须独立于 UIWorker：UIWorker 的 handler chain 会 await model.speak 等
 * 音频播放完毕，这会让 streamingSegments 的累积被串行阻塞——`llm:done` 同步
 * 触发时 segments 可能还是空的或不完整，导致 finalizeStream 把空内容写进
 * messages（表现为「不回复」），或下一轮 user 输入插队后旧 segments 被并到
 * 新一轮的 reply 里（表现为「前一条回答跑到新消息下面」）。
 *
 * 这里把"写历史"和"演出"解耦：dialog 一出来就同步进 streamingSegments，
 * audio 播放是独立的视觉/听觉演出，不阻塞文字落盘。
 */
function startChatStreamBridge(): () => void {
  const off = pipelineBus.on('llm:dialog', (msg) => {
    useChatStore.getState().appendStreamingSegment({
      item: {
        text: msg.text,
        emotion: msg.emotion,
        action: msg.effect,
      },
      ttsQueued: false,
    })
  })
  return off
}

export function startPipeline(): PipelineHandle {
  startLLMWorker()
  startTTSWorker()
  startUIWorker()
  const stopBridge = startChatStreamBridge()
  const stopASR = startASRBridge()
  return {
    dispose: () => {
      stopASR()
      stopBridge()
      stopLLMWorker()
      stopTTSWorker()
      stopUIWorker()
    },
    abort: () => {
      pipelineBus.emit('pipeline:abort', undefined)
    },
  }
}
