import { describe, expect, it } from 'vitest'
import { buildEnvBlock } from '../../src/renderer/src/features/pipeline/llmEnv'

const base = {
  timeText: '2026年11月5日 星期四 22:30',
  idleSeconds: 0,
  justReturned: false,
  awayMinutes: 0,
  game: null,
  foreground: { app: 'Code.exe', title: 'OpenGal', fullscreen: false },
}

function pulse(agoMs: number, peakScore: number) {
  return { score: peakScore, peakScore, changedAt: Date.now() - agoMs, sampledAt: Date.now() }
}

describe('环境提示里的屏幕状态', () => {
  it('没开屏幕观察时不写这一行', () => {
    const block = buildEnvBlock({ ...base, screen: null })
    expect(block).not.toContain('屏幕')
  })

  it('刚换过画面时提示可以去看', () => {
    const block = buildEnvBlock({ ...base, screen: pulse(5_000, 40) })
    expect(block).toContain('刚刚换了画面')
    expect(block).toContain('look_screen')
  })

  it('只是有小动静时不说换了画面', () => {
    const block = buildEnvBlock({ ...base, screen: pulse(10_000, 3) })
    expect(block).toContain('刚有动静')
    expect(block).not.toContain('换了画面')
  })

  it('长时间没变化时给出分钟数', () => {
    const block = buildEnvBlock({ ...base, screen: pulse(8 * 60_000, 1) })
    expect(block).toContain('8 分钟没有明显变化')
  })

  it('变化已经过去很久时不再提示可以去看', () => {
    const block = buildEnvBlock({ ...base, screen: pulse(10 * 60_000, 60) })
    expect(block).not.toContain('look_screen')
  })
})
