import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = {}
  return {
    configSet: vi.fn(),
    runtimeSetRunning: vi.fn(),
  }
})

vi.mock('@/components/shell/WindowBar', () => ({ WindowBar: () => null }))
vi.mock('@/components/shell/NavRail', () => ({ NavRail: () => null }))
vi.mock('@/components/stage/RoleStageCanvas', () => ({
  RoleStageCanvas: () => React.createElement('div', null, 'LEFT_STAGE'),
}))
vi.mock('@/components/chat/ChatThread', () => ({
  ChatThread: () => React.createElement('div', null, 'CHAT_THREAD'),
}))
vi.mock('@/components/chat/ChatComposerBar', () => ({
  ChatComposerBar: () => React.createElement('div', null, 'CHAT_COMPOSER'),
}))
vi.mock('@/components/chat/ContextUsageIndicator', () => ({
  ContextUsageIndicator: () => null,
}))
vi.mock('@/components/role/RoleCreatorPanel', () => ({
  RoleCreatorPanel: () => React.createElement('div', null, 'ROLE_CREATOR'),
}))
vi.mock('@/components/workshop/RoleWorkshopPanel', () => ({
  RoleWorkshopPanel: () => React.createElement('div', null, 'WORKSHOP'),
}))
vi.mock('@/components/settings/SettingsCenter', () => ({ SettingsCenter: () => null }))
vi.mock('@/components/market/MarketPage', () => ({ MarketPage: () => null }))
vi.mock('@/components/logs/LogsPanel', () => ({ LogsPanel: () => null }))

import App from '@/App'
import { useRoleStore } from '@/features/role/roleStore'
import { useRoleRuntimeStore } from '@/features/role/roleRuntimeStore'

describe('Studio 双栏工作台与多角色实例池交互', () => {
  beforeEach(() => {
    state.configSet = vi.fn()
    state.runtimeSetRunning = vi.fn()
    const list = [
      { id: 'a', name: 'A', performance: { mode: 'auto' }, persona: { description: '', personality: '' } },
      { id: 'b', name: 'B', performance: { mode: 'auto' }, persona: { description: '', personality: '' } },
    ] as never
    useRoleStore.setState({ activeId: 'a', list })
    Object.assign(useRoleStore.getInitialState(), { activeId: 'a', list })

    useRoleRuntimeStore.setState({ byId: { a: true, b: false } })
    Object.assign(useRoleRuntimeStore.getInitialState(), { byId: { a: true, b: false } })

    vi.stubGlobal('window', {
      opengal: {
        config: { set: state.configSet },
        runtime: { setRunning: state.runtimeSetRunning },
      },
    })
  })

  it('同时挂载左侧实时角色舞台与右侧无遮挡对话工作区，不再挂载三栏会话列表', () => {
    const html = renderToString(React.createElement(App))
    expect(html).toContain('LEFT_STAGE')
    expect(html).toContain('CHAT_THREAD')
    expect(html).toContain('CHAT_COMPOSER')
    expect(html).toContain('回到桌面陪伴')
    expect(html).not.toContain('SESSION_LIST')
  })

  it('无已创建角色时展示创建角色引导入口', () => {
    useRoleStore.setState({ activeId: null, list: [] })
    Object.assign(useRoleStore.getInitialState(), { activeId: null, list: [] })
    const html = renderToString(React.createElement(App))
    expect(html).toContain('还没有创建角色')
    expect(html).toContain('立即创建角色')
  })
})
