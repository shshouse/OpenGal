/**
 * 静音窗口：每来一次语音活动就顺延，但不能超过从最早一句算起的硬上限。
 * 返回距离下一次判定的毫秒数。
 */
export interface SilenceDelayInput {
  oldestAt: number
  now: number
  silenceWindowMs: number
  maxBufferWaitMs: number
}

export function nextSilenceDelay(input: SilenceDelayInput): number {
  const dueAt = Math.min(input.now + input.silenceWindowMs, input.oldestAt + input.maxBufferWaitMs)
  return Math.max(0, dueAt - input.now)
}
