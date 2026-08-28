export interface MessageHandler<T> {
  canHandle(msg: T): boolean
  handle(msg: T): void | Promise<void>
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
