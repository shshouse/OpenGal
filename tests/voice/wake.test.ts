import { describe, expect, it } from 'vitest'
import { WAKE_OPEN_MS, wakeEyeOpen } from '@shared/wake'

describe('wakeEyeOpen', () => {
  it('在开启时长内从 0 单调过渡到 1', () => {
    expect(wakeEyeOpen(0, 0)).toBe(0)
    expect(wakeEyeOpen(0, -100)).toBe(0)
    expect(wakeEyeOpen(0, WAKE_OPEN_MS)).toBe(1)
    expect(wakeEyeOpen(0, WAKE_OPEN_MS * 10)).toBe(1)

    let previous = -1
    for (let t = 0; t <= WAKE_OPEN_MS; t += 16) {
      const value = wakeEyeOpen(0, t)
      expect(value).toBeGreaterThanOrEqual(previous)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      previous = value
    }
    expect(previous).toBe(1)
    expect(Math.abs(wakeEyeOpen(0, WAKE_OPEN_MS / 2) - 0.5)).toBeLessThan(1e-9)
  })
})
