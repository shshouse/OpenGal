/**
 * 渲染进程内的流水线消息总线。
 *
 * 对应 RachelForster 中的 `Queue` + `QThread`：发布-订阅模式让 LLMWorker / TTSWorker / UIWorker
 * 解耦，三者各自只关心自己消费的消息类型。
 *
 * 设计上保持零依赖（不引入 mitt / EventEmitter3），实现极简，方便后续扩展和 SSR 隔离。
 */

import type {
  LLMDialogMessage,
  LLMTurnDoneMessage,
  ReasoningMessage,
  TTSOutputMessage,
  UserInputMessage,
} from '@shared/messages'

export interface PipelineEventMap {
  /** 用户输入进入流水线 */
  'user:input': UserInputMessage
  /** LLMWorker 输出一条对话片段，进入 TTSWorker */
  'llm:dialog': LLMDialogMessage
  /** LLMWorker 输出思维链增量，进入 BusyBar UI */
  'llm:reasoning': ReasoningMessage
  /** 一轮 LLM 流式响应结束 */
  'llm:done': LLMTurnDoneMessage
  /** TTSWorker 输出最终演出包，进入 UIWorker */
  'tts:output': TTSOutputMessage
  /** 全链路中断：清空队列，停 TTS，停 LLM 流 */
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
    // 遍历快照避免 listener 内 off 时迭代异常
    for (const fn of [...set] as PipelineListener<K>[]) {
      try {
        fn(payload)
      } catch (err) {
        console.error(`[pipelineBus] listener for "${String(event)}" threw`, err)
      }
    }
  }

  /** 测试/热重载用：清掉所有 listener。生产代码不要调用。 */
  clearAll(): void {
    this.listeners.clear()
  }
}

export const pipelineBus = new PipelineBus()
