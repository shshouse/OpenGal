import { beforeEach, describe, expect, it, vi } from 'vitest'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }],
  },
}))

const state = vi.hoisted(() => ({
  activeRoleId: 'miku' as string | null,
  card: null as null | { id: string; name: string; outfitEntries: Array<{ id: string; name: string; mode: string }> },
}))

vi.mock('../../src/main/services/config/store', () => ({
  readConfig: () => ({ activeRoleId: state.activeRoleId }),
}))

vi.mock('../../src/main/services/role/cardLoader', () => ({
  getRoleCard: (id: string) => (state.card && state.card.id === id ? state.card : null),
}))

import { changeOutfitTool } from '../../src/main/services/tools/outfit'

const card = {
  id: 'miku',
  name: 'Miku',
  outfitEntries: [
    { id: 'casual', name: '便服', mode: 'sprite' },
    { id: 'formal', name: '正装', mode: 'sprite' },
  ],
}

describe('change_outfit 工具', () => {
  beforeEach(() => {
    send.mockClear()
    state.activeRoleId = 'miku'
    state.card = card
  })

  it('不填服装时列出可选服装', async () => {
    const text = await changeOutfitTool.handle({})
    expect(text).toContain('casual（便服）')
    expect(text).toContain('formal（正装）')
    expect(send).not.toHaveBeenCalled()
  })

  it('按名称换装并通知渲染层', async () => {
    const text = await changeOutfitTool.handle({ outfit: '便服' })
    expect(text).toBe('已换成「便服」。')
    expect(send).toHaveBeenCalledWith('role:outfitChanged', { roleId: 'miku', outfitId: 'casual' })
  })

  it('找不到服装时不通知，只列出可选', async () => {
    const text = await changeOutfitTool.handle({ outfit: '泳装' })
    expect(text).toContain('没有「泳装」这套服装')
    expect(send).not.toHaveBeenCalled()
  })

  it('没有激活角色时直接说明', async () => {
    state.activeRoleId = null
    const text = await changeOutfitTool.handle({ outfit: '便服' })
    expect(text).toContain('没有激活的角色')
    expect(send).not.toHaveBeenCalled()
  })
})
