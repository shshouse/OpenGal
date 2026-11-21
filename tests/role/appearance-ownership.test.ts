import { describe, expect, it } from 'vitest'
import { validateRoleCard } from '../../src/shared/role/cardSchema'

const base = {
  id: 'role', name: 'role', windowMode: 'mate',
  performance: { mode: 'sprite', sprite: { spriteDir: 'sprites', defaultSprite: 'idle.png' } },
  persona: { description: '背景', personality: '性格' },
}

describe('角色外观归属', () => {
  it('角色卡保存立绘缩放和位置', () => {
    const result = validateRoleCard({ ...base, performance: { ...base.performance, transform: { scale: 1.2, xRatio: 0.6, yRatio: 0.4 } } })
    expect(result.ok).toBe(true)
    expect(result.card?.performance.transform).toEqual({ scale: 1.2, xRatio: 0.6, yRatio: 0.4 })
  })

  it('角色卡保存当前服装', () => {
    const result = validateRoleCard({ ...base, activeOutfitId: 'casual', performance: { ...base.performance, outfits: [{ id: 'casual', name: '便服', mode: 'sprite', sprite: { spriteDir: 'sprites', defaultSprite: 'idle.png' } }] } })
    expect(result.ok).toBe(true)
    expect(result.card?.activeOutfitId).toBe('casual')
  })
})
