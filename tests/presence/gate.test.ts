import { describe, expect, it } from 'vitest'
import { gateUtterance } from '../../src/shared/presence/gate'

const base = {
  text: '你今天回来得好晚',
  now: 60_000,
  lastReplyAt: 0,
  cooldownSec: 20,
  isSending: false,
  minChars: 2,
}

describe('语音门控', () => {
  it('冷却中丢弃', () => {
    expect(gateUtterance({ ...base, lastReplyAt: 55_000 })).toEqual({
      allow: false,
      skipWhy: 'cooldown',
    })
  })

  it('去掉标点后太短丢弃', () => {
    expect(gateUtterance({ ...base, text: '嗯。' })).toEqual({ allow: false, skipWhy: 'short' })
  })

  it('角色正在回复时丢弃', () => {
    expect(gateUtterance({ ...base, isSending: true })).toEqual({ allow: false, skipWhy: 'busy' })
  })

  it('正常语音放行', () => {
    expect(gateUtterance(base)).toEqual({ allow: true })
  })

  it('冷却优先于短句与忙碌', () => {
    expect(
      gateUtterance({ ...base, text: '嗯', lastReplyAt: 59_000, isSending: true }),
    ).toEqual({ allow: false, skipWhy: 'cooldown' })
  })
})
