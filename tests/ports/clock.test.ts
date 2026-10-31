import { describe, expect, it } from 'vitest'
import { SystemClock } from '../../src/main/adapters/system-clock'

describe('SystemClock', () => {
  it('now 与 monotonic 单调递增', () => {
    const clock = new SystemClock()
    expect(clock.now()).toBeGreaterThan(0)
    expect(clock.monotonic()).toBeGreaterThanOrEqual(0)
    expect(clock.monotonic()).toBeLessThanOrEqual(clock.monotonic())
  })

  it('sleep 正常结束', async () => {
    const clock = new SystemClock()
    await expect(clock.sleep(5)).resolves.toBeUndefined()
  })

  it('sleep 可被 AbortSignal 取消', async () => {
    const clock = new SystemClock()
    const controller = new AbortController()
    const pending = clock.sleep(10_000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('已取消的信号立即拒绝', async () => {
    const clock = new SystemClock()
    const controller = new AbortController()
    controller.abort()
    await expect(clock.sleep(1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
