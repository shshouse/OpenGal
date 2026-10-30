import { describe, expect, it } from 'vitest'
import { buildInitiativeNudge } from '../../src/shared/initiativeNudge'
import type { EnvSnapshot } from '../../src/shared/types'

function env(overrides: Partial<EnvSnapshot> = {}): EnvSnapshot {
  return {
    timeText: '22:10',
    idleSeconds: 300,
    justReturned: false,
    awayMinutes: 0,
    game: null,
    foreground: null,
    ...overrides,
  }
}

describe('主动开口提示', () => {
  const night = new Date(2026, 0, 1, 22, 0)

  it('包含静默时长与时间段', () => {
    const text = buildInitiativeNudge(12, env(), 'agent', night)
    expect(text).toContain('12 分钟')
    expect(text).toContain('晚上')
  })

  it('有前台窗口时说明对方在用什么', () => {
    const text = buildInitiativeNudge(5, env({ foreground: { app: 'Code.exe', title: 'OpenGal', fullscreen: false } }), 'life')
    expect(text).toContain('Code.exe')
  })

  it('没有窗口信息时不编造', () => {
    const text = buildInitiativeNudge(5, env(), 'life')
    expect(text).not.toContain('对方现在在用')
  })

  it('life 模式提示可以只是看着，不必每轮都说话', () => {
    expect(buildInitiativeNudge(5, env(), 'life', night)).toContain('也可以什么都不做')
    expect(buildInitiativeNudge(5, env(), 'agent', night)).not.toContain('也可以什么都不做')
  })

  it('带上角色语言时要求台词使用该语言', () => {
    const text = buildInitiativeNudge(5, env(), 'agent', night, '英语')
    expect(text).toContain('台词必须使用英语')
    expect(buildInitiativeNudge(5, env(), 'agent', night)).not.toContain('台词必须使用')
  })
})
