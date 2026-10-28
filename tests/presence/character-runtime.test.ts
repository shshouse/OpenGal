import { describe, expect, it } from 'vitest'
import {
  getHeadCrop,
  isCharacterRunning,
  toggleCharacterRunning,
} from '../../src/shared/characterRuntime'

describe('角色运行状态', () => {
  it('默认所有角色都是沉睡', () => {
    expect(isCharacterRunning(undefined, 'sonetto')).toBe(false)
    expect(isCharacterRunning({}, 'sonetto')).toBe(false)
  })

  it('每个角色独立切换，不影响其他角色', () => {
    const awake = toggleCharacterRunning({}, 'sonetto')
    expect(isCharacterRunning(awake, 'sonetto')).toBe(true)
    expect(isCharacterRunning(awake, 'neuro')).toBe(false)

    const both = toggleCharacterRunning(awake, 'neuro')
    expect(isCharacterRunning(both, 'sonetto')).toBe(true)
    expect(isCharacterRunning(both, 'neuro')).toBe(true)

    const asleep = toggleCharacterRunning(both, 'sonetto')
    expect(isCharacterRunning(asleep, 'sonetto')).toBe(false)
    expect(isCharacterRunning(asleep, 'neuro')).toBe(true)
  })

  it('没有角色 id 时不改变状态', () => {
    expect(toggleCharacterRunning({ a: true }, null)).toEqual({ a: true })
  })
})

describe('头像头部裁剪', () => {
  it('以顶部中心裁出方形头部区域', () => {
    expect(getHeadCrop(1000, 800)).toEqual({ x: 390, y: 0, size: 220 })
  })

  it('小图不会越过画布边界', () => {
    const crop = getHeadCrop(100, 50)
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.size).toBeLessThanOrEqual(100)
    expect(crop.y + crop.size).toBeLessThanOrEqual(50)
  })

  it('空画布返回空区域', () => {
    expect(getHeadCrop(0, 0)).toEqual({ x: 0, y: 0, size: 0 })
  })
})
