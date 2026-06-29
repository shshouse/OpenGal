/**
 * 通用 Handler 派发链，对齐 RachelForster `sdk/handlers.py` 的 MessageHandler 抽象。
 *
 * 用法：
 *   const chain = new HandlerChain<TTSOutputMessage>([
 *     new ChainOfThoughtUiHandler(),
 *     new OptionsUiHandler(),
 *     new DefaultDialogUiHandler(), // 兜底
 *   ])
 *   await chain.dispatch(msg)
 *
 * 链按数组顺序匹配，第一个 `canHandle` 命中的 handler 接管该消息；
 * 后续插件可以通过 `prepend` 注入更高优先级的 handler。
 */

export interface MessageHandler<T> {
  /** 该 handler 能否处理这条消息 */
  canHandle(msg: T): boolean
  /** 处理消息（同步或异步） */
  handle(msg: T): void | Promise<void>
  /** 处理后的清理钩子（可选） */
  postProcess?(msg: T): void | Promise<void>
}

export class HandlerChain<T> {
  private handlers: MessageHandler<T>[]

  constructor(handlers: MessageHandler<T>[] = []) {
    this.handlers = [...handlers]
  }

  prepend(handler: MessageHandler<T>): void {
    this.handlers.unshift(handler)
  }

  append(handler: MessageHandler<T>): void {
    this.handlers.push(handler)
  }

  remove(handler: MessageHandler<T>): boolean {
    const idx = this.handlers.indexOf(handler)
    if (idx < 0) return false
    this.handlers.splice(idx, 1)
    return true
  }

  async dispatch(msg: T): Promise<void> {
    for (const h of this.handlers) {
      if (!h.canHandle(msg)) continue
      try {
        await h.handle(msg)
      } catch (err) {
        console.error('[handlerChain] handler threw:', err)
      }
      try {
        await h.postProcess?.(msg)
      } catch (err) {
        console.error('[handlerChain] postProcess threw:', err)
      }
      return
    }
  }

  size(): number {
    return this.handlers.length
  }
}
