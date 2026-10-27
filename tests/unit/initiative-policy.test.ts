import { describe, expect, it } from 'vitest'
import { resolveInitiativePolicy } from '../../src/shared/initiativePolicy'

describe('主动开口策略', () => {
  it('导演关闭时一律不主动', () => {
    const policy = resolveInitiativePolicy({
      directorEnabled: false,
      directorMode: 'life',
      directorInitiativeEnabled: true,
      directorIdleMinutes: 10,
    })
    expect(policy.enabled).toBe(false)
  })

  it('agent 模式沿用用户开关与阈值', () => {
    const off = resolveInitiativePolicy({
      directorEnabled: true,
      directorMode: 'agent',
      directorInitiativeEnabled: false,
      directorIdleMinutes: 10,
    })
    expect(off.enabled).toBe(false)

    const on = resolveInitiativePolicy({
      directorEnabled: true,
      directorMode: 'agent',
      directorInitiativeEnabled: true,
      directorIdleMinutes: 10,
    })
    expect(on).toEqual({ enabled: true, idleMinutes: 10 })
  })

  it('life 模式默认主动，且静默阈值更短', () => {
    const policy = resolveInitiativePolicy({
      directorEnabled: true,
      directorMode: 'life',
      directorInitiativeEnabled: false,
      directorIdleMinutes: 10,
    })
    expect(policy).toEqual({ enabled: true, idleMinutes: 2 })
  })

  it('life 模式下用户已设更短的阈值时以用户为准', () => {
    const policy = resolveInitiativePolicy({
      directorEnabled: true,
      directorMode: 'life',
      directorInitiativeEnabled: true,
      directorIdleMinutes: 1,
    })
    expect(policy.idleMinutes).toBe(1)
  })
})
