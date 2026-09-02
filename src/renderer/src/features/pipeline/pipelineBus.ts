import type {
  LLMDialogMessage,
  LLMTurnDoneMessage,
  LLMUsageMessage,
  ReasoningMessage,
  TTSOutputMessage,
  UserInputMessage,
} from '@shared/messages'

export interface PipelineEventMap {
  'user:input': UserInputMessage
  'llm:dialog': LLMDialogMessage
  'llm:reasoning': ReasoningMessage
  'llm:done': LLMTurnDoneMessage
  'llm:usage': LLMUsageMessage
  'tts:output': TTSOutputMessage
  'pipeline:abort': void
}

type PipelineListener<K extends keyof PipelineEventMap> = (
  payload: PipelineEventMap[K],
) => void

class PipelineBus {
  private listeners: Map<keyof PipelineEventMap, Set<PipelineListener<never>>> = new Map()

  on<K extends keyof PipelineEventMap>(
    event: K,
    listener: PipelineListener<K>,
  ): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as PipelineListener<never>)
    return () => {
      set!.delete(listener as PipelineListener<never>)
    }
  }

  emit<K extends keyof PipelineEventMap>(
    event: K,
    payload: PipelineEventMap[K],
  ): void {
    const set = this.listeners.get(event)
    if (!set || set.size === 0) return
    for (const fn of [...set] as PipelineListener<K>[]) {
      try {
        fn(payload)
      } catch (err) {
        console.error(`[pipelineBus] listener for "${String(event)}" threw`, err)
      }
    }
  }

  clearAll(): void {
    this.listeners.clear()
  }
}

export const pipelineBus = new PipelineBus()
