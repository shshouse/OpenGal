import { startLLMWorker, stopLLMWorker, setActiveRoleCard, setGlobalMaxTokens, setGlobalContextWindow } from './llmWorker'
import { startTTSWorker, stopTTSWorker } from './ttsWorker'
import { startUIWorker, stopUIWorker } from './uiWorker'
import { startMemoryService } from '@/features/memory/memoryService'
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
  void window.opengal.config.get().then((res) => {
    const n = res.data?.llm?.maxTokens
    if (typeof n === 'number' && n > 0) setGlobalMaxTokens(n)
    const cw = res.data?.llm?.contextWindow
    if (typeof cw === 'number' && cw > 0) setGlobalContextWindow(cw)
  })
  startLLMWorker()
  startTTSWorker()
  startUIWorker()
  const stopMemory = startMemoryService()
  const stopBridge = startChatStreamBridge()
  const stopASR = startASRBridge()
  return {
    dispose: () => {
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
