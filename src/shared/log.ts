/**
 * 跨进程统一日志类型。main 进程通过 logBus 推送到 renderer，renderer 也可
 * appendLocal 自己的日志到同一个 store，UI 一处显示。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  timestamp: number
  level: LogLevel
  source: string
  message: string
  details?: string
}

export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

export function formatLogTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}
