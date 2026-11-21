import { describe, expect, it } from 'vitest'
import { validateRoleCard } from '../../src/shared/role/cardSchema'

const card = {
  id: 'test', name: '测试', windowMode: 'mate',
  performance: { mode: 'sprite', sprite: { spriteDir: 'sprites', defaultSprite: 'idle.png' } },
  persona: { description: '背景', personality: '性格' },
}
describe('角色头像区域保存', () => {
  it('从角色卡读入圆形头像区域', () => {
    const result = validateRoleCard({ ...card, performance: { ...card.performance, avatar: { x: 0.4, y: 0.2, radius: 0.15 } } })
    expect(result.ok).toBe(true)
    expect(result.card?.performance.avatar).toEqual({ x: 0.4, y: 0.2, radius: 0.15 })
  })
  it('拒绝超出范围的区域', () => {
    const result = validateRoleCard({ ...card, performance: { ...card.performance, avatar: { x: 2, y: 0.2, radius: 0.15 } } })
    expect(result.ok).toBe(false)
  })
  it('旧角色没有头像设置仍可读取', () => {
    expect(validateRoleCard(card).ok).toBe(true)
  })
})
