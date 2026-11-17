import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoleCardEntry } from '@shared/types'

const state = vi.hoisted(() => ({
  dataRoot: 'C:/fake-data',
  first: null as RoleCardEntry | null,
  second: null as RoleCardEntry | null,
  taken: [] as string[],
  calls: [] as Array<{ displayName: string; templateId: string; templateFolder: string }>,
}))

vi.mock('../../src/main/services/infra/paths', () => ({
  getDataRoot: () => state.dataRoot,
}))
vi.mock('../../src/main/services/role/cardLoader', () => ({
  getRoleCard: vi.fn(() => {
    const value = state.first
    state.first = state.second
    state.second = null
    return value
  }),
}))
vi.mock('../../src/main/services/role/store', () => ({
  isFolderNameTaken: vi.fn((_root: string, name: string) => state.taken.includes(name)),
  materializeRole: vi.fn((_root: string, _template: string, displayName: string, template: { id: string; folder: string }) => {
    state.calls.push({ displayName, templateId: template.id, templateFolder: template.folder })
    return ''
  }),
}))

import { createRoleCopy } from '../../src/main/services/role/roleCopy'

function builtinCard(): RoleCardEntry {
  return {
    id: 'kaltsit',
    name: '凯尔希',
    displayName: '凯尔希',
    windowMode: 'mate',
    performance: { mode: 'auto' },
    persona: { description: '描述', personality: '性格' },
    rootPath: 'C:/mods/Role/凯尔希',
    folderName: '凯尔希',
    builtin: true,
  }
}

beforeEach(() => {
  state.first = null
  state.second = null
  state.taken = []
  state.calls = []
})

describe('创建可编辑角色副本', () => {
  it('把市场模板复制为玩家角色，并返回可编辑角色', () => {
    const source = builtinCard()
    state.first = source
    state.second = { ...source, builtin: false, rootPath: 'C:/fake-data/roles/凯尔希（我的）' }

    const copied = createRoleCopy('kaltsit')

    expect(copied.builtin).toBe(false)
    expect(state.calls).toEqual([{
      displayName: '凯尔希（我的）',
      templateId: 'kaltsit',
      templateFolder: '凯尔希',
    }])
  })

  it('目录重名时自动加序号', () => {
    state.taken = ['凯尔希（我的）']
    state.first = builtinCard()
    state.second = { ...builtinCard(), builtin: false }

    createRoleCopy('kaltsit')

    expect(state.calls[0]?.displayName).toBe('凯尔希（我的） 2')
  })
})
