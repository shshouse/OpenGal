import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoleCardEntry } from '@shared/types'

const state = vi.hoisted(() => ({
  dataRoot: 'C:/fake-data',
  source: null as RoleCardEntry | null,
  template: null as RoleCardEntry | null,
  created: null as RoleCardEntry | null,
  taken: [] as string[],
  nextId: 'kaltsit',
  calls: [] as Array<{
    displayName: string
    templateId: string
    templateFolder: string
    roleId?: string
  }>,
}))

vi.mock('../../src/main/services/infra/paths', () => ({
  getDataRoot: () => state.dataRoot,
}))
vi.mock('../../src/main/services/role/cardLoader', () => ({
  getRoleCard: vi.fn(() => state.source),
  getOwnedRoleCard: vi.fn(() => state.created),
  listRoleTemplatesDetailed: vi.fn(() =>
    state.template ? [{ entry: state.template, issues: [] }] : [],
  ),
}))
vi.mock('../../src/main/services/role/store', () => ({
  allocateUniqueRoleId: vi.fn(() => state.nextId),
  isFolderNameTaken: vi.fn((_root: string, name: string) => state.taken.includes(name)),
  allocateRoleFolder: vi.fn((_root: string, name: string) => state.taken.includes(name) ? `${name} 2` : name),
  materializeRole: vi.fn(
    (
      _root: string,
      _template: string,
      displayName: string,
      template: { id: string; folder: string },
      opts?: { roleId?: string },
    ) => {
      state.calls.push({
        displayName,
        templateId: template.id,
        templateFolder: template.folder,
        roleId: opts?.roleId,
      })
      return ''
    },
  ),
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
  state.source = null
  state.created = null
  state.template = null
  state.taken = []
  state.nextId = 'kaltsit'
  state.calls = []
})

describe('从模组模板创建独立角色实例', () => {
  it('把模组模板复制为玩家独立角色，并分配唯一实例 ID', () => {
    const source = builtinCard()
    state.source = source
    state.created = { ...source, id: 'kaltsit', builtin: false, rootPath: 'C:/fake-data/roles/凯尔希' }

    const copied = createRoleCopy('kaltsit')

    expect(copied.builtin).toBe(false)
    expect(state.calls).toEqual([
      {
        displayName: '凯尔希',
        templateId: 'kaltsit',
        templateFolder: '凯尔希',
        roleId: 'kaltsit',
      },
    ])
  })

  it('目录与角色 ID 重名时自动递增序号生成独立实例', () => {
    state.taken = ['凯尔希']
    state.nextId = 'kaltsit-2'
    state.source = builtinCard()
    state.created = { ...builtinCard(), id: 'kaltsit-2', builtin: false }

    const copied = createRoleCopy('kaltsit')

    expect(copied.id).toBe('kaltsit-2')
    expect(state.calls[0]?.displayName).toBe('凯尔希 2')
    expect(state.calls[0]?.roleId).toBe('kaltsit-2')
  })

  it('模组模板与已创建角色同 id 时，仍从模组模板实例化', () => {
    state.source = {
      ...builtinCard(),
      builtin: false,
      displayName: "凯尔希 Kal'tsit（副本）",
      folderName: "凯尔希 Kal'tsit",
      rootPath: "C:/fake-data/roles/凯尔希 Kal'tsit",
    }
    state.template = builtinCard()
    state.created = { ...builtinCard(), builtin: false }
    state.nextId = 'kaltsit-2'

    createRoleCopy('kaltsit')

    expect(state.calls[0]?.templateFolder).toBe('凯尔希')
    expect(state.calls[0]?.displayName).toBe('凯尔希')
    expect(state.calls[0]?.roleId).toBe('kaltsit-2')
  })
})
