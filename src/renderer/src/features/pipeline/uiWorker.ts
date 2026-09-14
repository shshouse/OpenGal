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
    new DefaultDialogUiHandler(),
  ])

  const offOutput = pipelineBus.on('tts:output', (out) => {
    queue.push(out)
    void drainQueue()
  })

  const offAbort = pipelineBus.on('pipeline:abort', () => {
    // 不改写 processing：在途 dispatch 的 finally 会复位，外部强置 false 会放第二个 drain 进来
    queue = []
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
