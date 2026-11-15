/**
 * 统一提取错误信息。
 * catch 到的值类型不受控（可能是字符串、对象、null），直接访问 `.message`
 * 会在非 Error 时得到 undefined，导致日志里只剩 "undefined"。
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err === null) return 'null'
  if (err === undefined) return 'undefined'
  if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
    return err.toString()
  }
  if (typeof err === 'symbol') return err.description ?? 'symbol'
  if (typeof err === 'function') return err.name || 'anonymous function'
  try {
    return JSON.stringify(err) ?? '[不可序列化的对象]'
  } catch {
    return '[不可序列化的对象]'
  }
}

/** 非 Error 没有调用栈，直接返回 undefined 供日志的 details 参数使用。 */
export function getErrorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined
}

/** 用于判断 AbortError 这类按 name 分流的场景。 */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
