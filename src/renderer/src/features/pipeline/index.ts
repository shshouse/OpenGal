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
    })
  })
  return off
}

// segments 清空时不推空串，气泡由宠物端计时自动隐藏
function startPetBubbleBridge(): () => void {
  let last = ''
  return useChatStore.subscribe((state) => {
    const segs = state.streamingSegments
    if (segs.length === 0) {
      last = ''
      return
    }
    const text = segs.map((s) => s.item.text).join('').trim()
    if (!text || text === last) return
    last = text
    window.opengal.pet.setBubble(text)
  })
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
  const stopPetBubble = startPetBubbleBridge()
  return {
    dispose: () => {
      stopPetBubble()
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
