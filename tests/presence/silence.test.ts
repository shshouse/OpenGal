import { describe, expect, it } from 'vitest'
import { nextSilenceDelay } from '../../src/shared/presence/silence'

describe('静音窗口', () => {
  it('默认等满一个静音窗口', () => {
    expect(
      nextSilenceDelay({ oldestAt: 10_000, now: 10_000, silenceWindowMs: 2_500, maxBufferWaitMs: 8_000 }),
    ).toBe(2_500)
  })

  it('新的语音活动会顺延窗口', () => {
    expect(
      nextSilenceDelay({ oldestAt: 10_000, now: 12_000, silenceWindowMs: 2_500, maxBufferWaitMs: 8_000 }),
    ).toBe(2_500)
  })

  it('不能超过从最早一句算起的硬上限', () => {
    expect(
      nextSilenceDelay({ oldestAt: 10_000, now: 17_500, silenceWindowMs: 2_500, maxBufferWaitMs: 8_000 }),
    ).toBe(500)
  })

  it('已经超时则立即判定', () => {
    expect(
      nextSilenceDelay({ oldestAt: 10_000, now: 19_000, silenceWindowMs: 2_500, maxBufferWaitMs: 8_000 }),
    ).toBe(0)
  })
})
