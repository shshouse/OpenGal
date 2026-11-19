import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mockState = vi.hoisted(() => ({
  activeRoleId: null as string | null,
  runningRoles: {} as Record<string, boolean>,
  written: [] as Array<Record<string, unknown>>,
}))

vi.mock('../../src/main/services/config/store', () => ({
  readConfig: () => ({
    activeRoleId: mockState.activeRoleId,
    runningRoles: mockState.runningRoles,
    llm: { apiKey: '', baseURL: '', modelName: '' },
  }),
  writeConfig: (patch: Record<string, unknown>) => {
    mockState.written.push(patch)
    if ('runningRoles' in patch && patch.runningRoles) {
      mockState.runningRoles = patch.runningRoles as Record<string, boolean>
    }
    if ('activeRoleId' in patch) {
      mockState.activeRoleId = (patch.activeRoleId as string | null) ?? null
    }
  },
}))

import { closeMemoryDb, initMemoryDb, memoryDbReady } from '../../src/main/services/memory/db'
import { setReadyPromise } from '../../src/main/services/memory/db/core'
import { createBlankRoleDir } from '../../src/main/services/role/store'
import {
  initRoleRuntimePool,
  setRoleLifePausedInPool,
  shutdownRoleRuntimePool,
} from '../../src/main/services/runtime/roleRuntimePool'

describe('P1-4 启动唤醒策略与 Life 默认暂停防静默计费', () => {
  let tmpRoot = ''
  const prevDataDir = process.env.OPENGAL_DATA_DIR

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'og-wake-policy-'))
    process.env.OPENGAL_DATA_DIR = tmpRoot
    mockState.activeRoleId = null
    mockState.runningRoles = {}
    mockState.written = []
    shutdownRoleRuntimePool()
    closeMemoryDb()
    setReadyPromise(null)
    await initMemoryDb(tmpRoot)
    await memoryDbReady()
  })

  afterEach(() => {
    shutdownRoleRuntimePool()
    closeMemoryDb()
    setReadyPromise(null)
    if (prevDataDir === undefined) delete process.env.OPENGAL_DATA_DIR
    else process.env.OPENGAL_DATA_DIR = prevDataDir
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('上次退出时没有运行中的角色时，启动绝不自动唤醒任何角色', async () => {
    const created = createBlankRoleDir(tmpRoot, {
      name: 'kaltsit',
      displayName: '凯尔希',
      mode: 'life',
      persona: { description: '医生', personality: '冷静' },
    })
    mockState.activeRoleId = created.roleId
    mockState.runningRoles = {}

    const snap = await initRoleRuntimePool()
    expect(snap.focusedRoleId).toBe(created.roleId)
    expect(snap.runningRoleIds).toEqual([])
    expect(snap.roles[created.roleId]?.running).toBe(false)
  })

  it('恢复上次运行中的 Life 角色时默认先暂停自主循环，需显式开启才运行', async () => {
    const created = createBlankRoleDir(tmpRoot, {
      name: 'miku',
      displayName: '初音未来',
      mode: 'life',
      persona: { description: '歌姬', personality: '开朗' },
    })
    mockState.activeRoleId = created.roleId
    mockState.runningRoles = { [created.roleId]: true }

    const snap = await initRoleRuntimePool()
    expect(snap.runningRoleIds).toEqual([created.roleId])
    expect(snap.roles[created.roleId]?.running).toBe(true)
    expect(snap.roles[created.roleId]?.lifePaused).toBe(true)

    const resumed = await setRoleLifePausedInPool(created.roleId, false)
    expect(resumed.roles[created.roleId]?.lifePaused).toBe(false)
  })
})
