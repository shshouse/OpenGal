import { describe, expect, it } from 'vitest'
import { mergeUIState, type UIState } from '../../src/shared/uiState'

const base: UIState = {
  view: 'home',
  window: { x: 10, y: 20, width: 1200, height: 780, maximized: false },
  mate: { x: 30, y: 40, width: 320, height: 420, open: false },
  chat: { ratio: 0.5, collapsed: false },
  market: { page: 1, sort: 'latest' },
}

describe('UI 状态合并', () => {
  it('分区补丁不会丢掉同分区其他字段', () => {
    const next = mergeUIState(base, { chat: { ratio: 0.6 } })
    expect(next.chat).toEqual({ ratio: 0.6, collapsed: false })
  })

  it('只改桌宠开关时保留位置和大小', () => {
    const next = mergeUIState(base, { mate: { open: true } })
    expect(next.mate).toMatchObject({ x: 30, y: 40, width: 320, height: 420, open: true })
  })

  it('顶层字段独立更新', () => {
    const next = mergeUIState(base, { view: 'settings', memorySearch: '生日' })
    expect(next.view).toBe('settings')
    expect(next.memorySearch).toBe('生日')
    expect(next.window).toEqual(base.window)
  })

  it('没有旧分区时也能接收部分字段', () => {
    const next = mergeUIState({}, { mate: { open: true } })
    expect(next.mate).toEqual({ open: true })
  })
})
