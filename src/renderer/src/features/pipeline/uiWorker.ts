import type { TTSOutputMessage } from '@shared/messages'
import { HandlerChain, type MessageHandler } from './handlerChain'
import { pipelineBus } from './pipelineBus'
import { DefaultDialogUiHandler, stopFallbackAudio } from './uiHandlers'

let bound = false
let unsubscribers: Array<() => void> = []
let queue: TTSOutputMessage[] = []
let processing = false
let chain: HandlerChain<TTSOutputMessage> | null = null

export function startUIWorker(extraHandlers: MessageHandler<TTSOutputMessage>[] = []): () => void {
  if (bound) return stopUIWorker
  bound = true

  chain = new HandlerChain<TTSOutputMessage>([
    ...extraHandlers,
    new DefaultDialogUiHandler(), // 兜底：所有非系统消息
  ])

  const offOutput = pipelineBus.on('tts:output', (out) => {
    queue.push(out)
    void drainQueue()
  })

  const offAbort = pipelineBus.on('pipeline:abort', () => {
    queue = []
    processing = false
    stopFallbackAudio()
  })

  unsubscribers = [offOutput, offAbort]
  return stopUIWorker
}

export function stopUIWorker(): void {
  for (const off of unsubscribers) off()
  unsubscribers = []
  bound = false
  queue = []
  processing = false
  chain = null
}

async function drainQueue(): Promise<void> {
  if (processing || !chain) return
  processing = true
  try {
    while (queue.length > 0) {
      const out = queue.shift()!
      await chain.dispatch(out)
    }
  } finally {
    processing = false
  }
}
