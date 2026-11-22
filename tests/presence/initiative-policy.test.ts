import { describe, expect, it } from 'vitest'
import { resolveInitiativePolicy } from '../../src/shared/presence/initiativePolicy'

describe('主动开口策略', () => {
  it('导演关闭时一律不主动', () => {
    const policy = resolveInitiativePolicy({
      directorEnabled: false,
      directorInitiativeEnabled: true,
      directorIdleMinutes: 10,
    })
    expect(policy.enabled).toBe(false)
  })

  it('agent 模式沿用用户开关与阈值', () => {
    const off = resolveInitiativePolicy({
      directorEnabled: true,
      directorInitiativeEnabled: false,
      directorIdleMinutes: 10,
    })
    expect(off.enabled).toBe(false)

    const on = resolveInitiativePolicy({
      directorEnabled: true,
      directorInitiativeEnabled: true,
      directorIdleMinutes: 10,
    })
    expect(on).toEqual({ enabled: true, idleMinutes: 10 })
  })
})
