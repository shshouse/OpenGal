/**
 * 平台时钟端口。
 *
 * 世界时钟补算、冷却与批次都依赖它；核心不得直接使用 Date.now。
 */
export interface Clock {
  /** epoch 毫秒 */
  now(): number
  /** 单调时钟毫秒，只用于计算耗时 */
  monotonic(): number
  /** IANA 时区，如 Asia/Shanghai */
  timeZone(): string
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}
