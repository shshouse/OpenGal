import { describe, expect, it } from 'vitest'
import { isRoleRunning, toggleRoleRunning } from '@shared/role/runtime'
import { getHeadCrop, getImageHeadCrop } from '@/lib/headCrop'

describe('角色运行状态', () => {
  it('默认所有角色都是沉睡', () => {
    expect(isRoleRunning(undefined, 'sonetto')).toBe(false)
    expect(isRoleRunning({}, 'sonetto')).toBe(false)
  })

  it('每个角色独立切换，不影响其他角色', () => {
    const awake = toggleRoleRunning({}, 'sonetto')
    expect(isRoleRunning(awake, 'sonetto')).toBe(true)
    expect(isRoleRunning(awake, 'neuro')).toBe(false)

    const both = toggleRoleRunning(awake, 'neuro')
    expect(isRoleRunning(both, 'sonetto')).toBe(true)
    expect(isRoleRunning(both, 'neuro')).toBe(true)

    const asleep = toggleRoleRunning(both, 'sonetto')
    expect(isRoleRunning(asleep, 'sonetto')).toBe(false)
    expect(isRoleRunning(asleep, 'neuro')).toBe(true)
  })

  it('没有角色 id 时不改变状态', () => {
    expect(toggleRoleRunning({ a: true }, null)).toEqual({ a: true })
  })
})

describe('头像头部裁剪', () => {
  it('以顶部中心裁出方形头部区域', () => {
    expect(getHeadCrop(1000, 800)).toEqual({ x: 390, y: 0, size: 220 })
  })

  it('模型偏离画布中心时按模型位置裁剪', () => {
    expect(getHeadCrop(1000, 800, { x: 600, y: 40, width: 240, height: 700 })).toEqual({
      x: 665,
      y: 40,
      size: 110,
    })
  })

  it('立绘整图从顶部中心裁头，而不是取中间', () => {
    expect(getImageHeadCrop(342, 1024)).toEqual({ x: 38, y: 0, size: 266 })
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
