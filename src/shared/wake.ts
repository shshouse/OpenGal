// 唤醒睁眼进度：smoothstep 从 0 缓动到 1
export const WAKE_OPEN_MS = 800

export function wakeEyeOpen(startMs: number, nowMs: number): number {
  const t = Math.min(1, Math.max(0, (nowMs - startMs) / WAKE_OPEN_MS))
  return t * t * (3 - 2 * t)
}
