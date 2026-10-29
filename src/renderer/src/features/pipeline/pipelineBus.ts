import type {
  LLMDialogMessage,
  LLMTurnDoneMessage,
  ReasoningMessage,
  TTSOutputMessage,
  UserInputMessage,
} from '@shared/messages'

export interface PipelineEventMap {
  'user:speechStart': void
  'asr:settingsChanged': void
  'user:input': UserInputMessage
  'llm:dialog': LLMDialogMessage
  'llm:reasoning': ReasoningMessage
  'llm:done': LLMTurnDoneMessage
  'tts:output': TTSOutputMessage
  'tts:segmentStart': TTSOutputMessage
  'tts:playback': { speaking: boolean; characterId?: string }
  'pipeline:abort': void
}

type PipelineListener<K extends keyof PipelineEventMap> = (
  payload: PipelineEventMap[K],
) => void

export interface PipelineTrace {
  event: keyof PipelineEventMap
  payload: unknown
  listeners: number
  at: number
}

class PipelineBus {
  private listeners: Map<keyof PipelineEventMap, Set<PipelineListener<never>>> = new Map()
  private tracer: ((trace: PipelineTrace) => void) | null = null

  setTracer(tracer: ((trace: PipelineTrace) => void) | null): void {
    this.tracer = tracer
  }

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
    const count = set?.size ?? 0
    try {
      this.tracer?.({ event, payload, listeners: count, at: Date.now() })
    } catch {
      /* tracer 失败不影响事件派发 */
    }
    if (!set || count === 0) return
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
