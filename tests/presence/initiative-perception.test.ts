import { describe, expect, it } from 'vitest'
import { buildInitiativePerception } from '../../src/renderer/src/features/pipeline/initiativePerception'
import type { EnvSnapshot } from '../../src/shared/types'

const env: EnvSnapshot = {
  timeText: '22:10',
  idleSeconds: 900,
  justReturned: false,
  awayMinutes: 0,
  game: null,
  foreground: { app: 'Code.exe', title: 'OpenGal - VS Code', fullscreen: false },
}

describe('主动时刻感知', () => {
  it('总是带上空闲事件', () => {
    const events = buildInitiativePerception(1000, 120_000, null)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'idle', sinceMs: 120_000, trusted: true })
  })

  it('有前台窗口时附带应用事件', () => {
    const events = buildInitiativePerception(1000, 120_000, env)
    expect(events).toHaveLength(2)
    const app = events.find((e) => e.kind === 'app')
    expect(app).toMatchObject({ name: 'Code.exe', title: 'OpenGal - VS Code' })
  })

  it('全屏游戏时标记出来，供导演判断是否打扰', () => {
    const events = buildInitiativePerception(1000, 120_000, {
      ...env,
      foreground: { app: 'game.exe', title: 'Game', fullscreen: true },
    })
    const app = events.find((e) => e.kind === 'app')
    expect(app).toMatchObject({ fullscreen: true })
  })
})
