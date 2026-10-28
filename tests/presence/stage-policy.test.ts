import { describe, expect, it } from 'vitest'
import { shouldShowMainStage } from '../../src/shared/stagePolicy'

describe('皮套互斥', () => {
  it('桌宠打开时主窗口不显示皮套', () => {
    expect(shouldShowMainStage(true, true)).toBe(false)
  })

  it('桌宠关闭且用户允许时显示皮套', () => {
    expect(shouldShowMainStage(true, false)).toBe(true)
  })

  it('用户关闭皮套时不显示', () => {
    expect(shouldShowMainStage(false, false)).toBe(false)
  })
})
