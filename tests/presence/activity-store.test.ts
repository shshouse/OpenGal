import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const values = new Map<string, string>()
  const storage = {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  ;(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage
  return storage
})

import { selectActivities, useActivityStore } from '../../src/renderer/src/features/activity/activityStore'

function entry(id: string, characterId = 'a') {
  return { id, characterId, kind: 'speech' as const, title: id, at: 1 }
}

describe('activity store', () => {
  beforeEach(() => {
    useActivityStore.setState({ byCharacter: {} })
    storage.values.clear()
  })

  it('按角色隔离、去重并只保留最近 200 条', () => {
    for (let i = 0; i < 205; i++) useActivityStore.getState().add(entry(String(i)))
    useActivityStore.getState().add(entry('204'))
    useActivityStore.getState().add(entry('b-1', 'b'))

    const a = useActivityStore.getState().byCharacter.a
    expect(a).toHaveLength(200)
    expect(a[0].id).toBe('5')
    expect(a.at(-1)?.id).toBe('204')
    expect(useActivityStore.getState().byCharacter.b).toHaveLength(1)
  })

  it('空角色选择器返回稳定引用，避免无限重渲染', () => {
    const state = useActivityStore.getState()
    expect(selectActivities(state, 'missing')).toBe(selectActivities(state, 'missing'))
  })

  it('支持 constructor 等合法但特殊的角色 ID', () => {
    useActivityStore.getState().add(entry('special', 'constructor'))
    expect(selectActivities(useActivityStore.getState(), 'constructor')).toHaveLength(1)
  })

  it('清空指定角色不影响其他角色', () => {
    useActivityStore.getState().add(entry('a-1'))
    useActivityStore.getState().add(entry('b-1', 'b'))
    useActivityStore.getState().clearCharacter('a')

    expect(useActivityStore.getState().byCharacter.a).toBeUndefined()
    expect(useActivityStore.getState().byCharacter.b).toHaveLength(1)
  })
})
