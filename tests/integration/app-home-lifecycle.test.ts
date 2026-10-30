import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = {}
  return {
    homeProps: null as null | { onToggleRunning: (id: string) => Promise<void> },
    configSet: vi.fn(),
  }
})

vi.mock('@/components/home/HomePage', () => ({
  HomePage: (props: { onToggleRunning: (id: string) => Promise<void> }) => {
    state.homeProps = props
    return React.createElement('div', null, 'HOME')
  },
}))
vi.mock('@/components/chat/ChatWorkspace', () => ({
  ChatWorkspace: ({ chat, stage }: { chat: React.ReactNode; stage: React.ReactNode }) =>
    React.createElement('div', null, 'WORKSPACE', chat, stage),
}))
vi.mock('@/components/chat/GalgameChatPanel', () => ({
  GalgameChatPanel: () => React.createElement('div', null, 'CHAT_PANEL'),
}))
vi.mock('@/components/dashboard/RoleDashboard', () => ({ RoleDashboard: () => null }))
vi.mock('@/components/live2d/Live2DStage', () => ({ Live2DStage: () => null }))
vi.mock('@/components/sprite/SpriteStage', () => ({ SpriteStage: () => null }))
vi.mock('@/components/titlebar/TitleBar', () => ({ TitleBar: () => null }))
vi.mock('@/components/nav/Sidebar', () => ({ Sidebar: () => null }))
vi.mock('@/components/settings/SettingsCenter', () => ({ SettingsCenter: () => null }))
vi.mock('@/components/market/MarketPage', () => ({ MarketPage: () => null }))
vi.mock('@/components/logs/LogsPanel', () => ({ LogsPanel: () => null }))

import App from '../../src/renderer/src/App'
import { useCharacterStore } from '../../src/renderer/src/features/character/characterStore'
import { useCharacterRuntimeStore } from '../../src/renderer/src/features/character/characterRuntimeStore'

describe('App home lifecycle', () => {
  beforeEach(() => {
    state.homeProps = null
    state.configSet = vi.fn()
    useCharacterStore.setState({
      activeId: 'a',
      list: [
        { id: 'a', name: 'A', performance: { mode: 'auto' }, persona: { description: '', personality: '' } },
        { id: 'b', name: 'B', performance: { mode: 'auto' }, persona: { description: '', personality: '' } },
      ] as never,
      setActive: async (id: string) => { useCharacterStore.setState({ activeId: id }) },
    })
    useCharacterRuntimeStore.setState({ byId: { a: true, b: false } })
    vi.stubGlobal('window', {
      opengal: {
        config: { set: state.configSet },
      },
    })
  })

  it('主页仍保留工作区与聊天面板挂载', () => {
    const html = renderToString(React.createElement(App))
    expect(html).toContain('HOME')
    expect(html).toContain('WORKSPACE')
    expect(html).toContain('CHAT_PANEL')
  })

  it('主页切换后台角色运行状态不改变当前角色', async () => {
    state.configSet.mockResolvedValue({ success: true, data: {} })
    renderToString(React.createElement(App))
    await state.homeProps!.onToggleRunning('b')

    expect(useCharacterStore.getState().activeId).toBe('a')
    expect(useCharacterRuntimeStore.getState().byId.b).toBe(true)
  })

  it('配置保存失败时运行状态保持原值', async () => {
    state.configSet.mockResolvedValue({ success: false, error: 'disk full' })
    renderToString(React.createElement(App))
    await state.homeProps!.onToggleRunning('b')

    expect(useCharacterStore.getState().activeId).toBe('a')
    expect(useCharacterRuntimeStore.getState().byId.b).toBe(false)
  })
})
