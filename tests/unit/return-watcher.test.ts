import { describe, expect, it } from 'vitest'
import { detectReturn } from '../../src/renderer/src/features/pipeline/initiativePerception'
import type { EnvSnapshot } from '../../src/shared/types'

function env(justReturned: boolean): EnvSnapshot {
  return {
    timeText: '09:00',
    idleSeconds: justReturned ? 0 : 600,
    justReturned,
    awayMinutes: justReturned ? 30 : 0,
    game: null,
    foreground: null,
  }
}

describe('回来检测', () => {
  it('从离开状态变为刚回来时触发一次', () => {
    expect(detectReturn(false, env(true))).toEqual({ fire: true, wasReturned: true })
  })

  it('持续处于刚回来状态时不再重复触发', () => {
    expect(detectReturn(true, env(true))).toEqual({ fire: false, wasReturned: true })
  })

  it('没有环境信息时保持原状态且不触发', () => {
    expect(detectReturn(false, null)).toEqual({ fire: false, wasReturned: false })
  })

  it('回来后再次离开会重置状态', () => {
    expect(detectReturn(true, env(false))).toEqual({ fire: false, wasReturned: false })
    expect(detectReturn(false, env(true))).toEqual({ fire: true, wasReturned: true })
  })
})
