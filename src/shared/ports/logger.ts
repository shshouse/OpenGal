export type LogFields = Record<string, unknown>

/** 日志端口：核心只报事实，落盘与展示由适配层决定。 */
export interface Logger {
  debug(source: string, message: string, fields?: LogFields): void
  info(source: string, message: string, fields?: LogFields): void
  warn(source: string, message: string, fields?: LogFields): void
  error(source: string, message: string, fields?: LogFields): void
}
