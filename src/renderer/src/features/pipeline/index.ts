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

// 气泡跟音频段走：文字和语音同时出现；聊天记录仍按 LLM 流即时追加
function startPetBubbleBridge(): () => void {
  let text = ''
  let last = ''
  const push = (): void => {
    const t = text.trim()
    if (!t || t === last) return
    last = t
    window.opengal.pet.setBubble(t)
  }
  const offSegment = pipelineBus.on('tts:segmentStart', (msg) => {
    text += msg.text
    push()
  })
  const reset = (): void => {
    text = ''
    last = ''
  }
  const offUser = pipelineBus.on('user:input', reset)
  const offAbort = pipelineBus.on('pipeline:abort', reset)
  return () => {
    offSegment()
    offUser()
    offAbort()
  }
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
