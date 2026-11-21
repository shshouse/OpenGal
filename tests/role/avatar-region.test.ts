import { describe, expect, it } from 'vitest'
import { avatarCropPixels, clampAvatarRegion } from '../../src/shared/role/avatar'

describe('圆形头像区域', () => {
  it('将归一化区域映射为源图像素，不随显示尺寸漂移', () => {
    expect(avatarCropPixels({ x: 0.4, y: 0.4, radius: 0.15 }, 1000, 2000)).toEqual({ x: 250, y: 650, size: 300 })
  })
  it('圆始终留在图片内', () => {
    expect(clampAvatarRegion({ x: 0, y: 1, radius: 0.8 }, 1)).toEqual({ x: 0.5, y: 0.5, radius: 0.5 })
  })
  it('竖图裁切的纵向位置来自图片高度', () => {
    expect(avatarCropPixels({ x: 0.5, y: 0.4, radius: 0.2 }, 600, 1200)).toEqual({ x: 180, y: 360, size: 240 })
  })
  it('非法尺寸不会生成选区', () => {
    expect(avatarCropPixels({ x: 0.5, y: 0.5, radius: 0.2 }, 0, 100)).toEqual({ x: 0, y: 0, size: 0 })
  })
})
