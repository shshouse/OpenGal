import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const values = new Map<string, string>()
  const target = {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  ;(globalThis as unknown as { localStorage: typeof target }).localStorage = target
  return target
})

vi.mock('../../src/renderer/src/features/chat/chatStore', () => ({
  useChatStore: { getState: () => ({ sessionId: 'role' }) },
}))
vi.mock('../../src/renderer/src/features/pipeline/pipelineBus', () => ({
  pipelineBus: { on: () => () => {} },
}))

import { startActivityBridge } from '../../src/renderer/src/features/activity/activityBridge'
import { useActivityStore } from '../../src/renderer/src/features/activity/activityStore'
import { useToolCallsStore, type ToolCallRecord } from '../../src/renderer/src/features/tools/toolCallsStore'

function record(id: string, name = 'web_search'): ToolCallRecord {
  return { id, name, args: {}, ok: true, result: 'done', durationMs: 1 }
}

describe('activity bridge', () => {
  let stop: () => void
  beforeEach(() => {
    useActivityStore.setState({ byCharacter: {} })
    useToolCallsStore.setState({ records: [] })
    storage.values.clear()
    storage.setItem = (key, value) => { storage.values.set(key, value) }
    stop = startActivityBridge()
  })
  afterEach(() => stop())

  it('不同回合复用 provider 调用 ID 时仍分别记录', () => {
    useToolCallsStore.getState().add(record('call_0', 'first'))
    useToolCallsStore.getState().clear()
    useToolCallsStore.getState().add(record('call_0', 'second'))

    const entries = useActivityStore.getState().byCharacter.role
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.title)).toEqual(['调用 first', '调用 second'])
  })

  it('localStorage 写满不影响成功的工具调用', () => {
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }

    expect(() => useToolCallsStore.getState().add(record('call_1'))).not.toThrow()
    expect(useActivityStore.getState().byCharacter.role).toHaveLength(1)
  })
})
