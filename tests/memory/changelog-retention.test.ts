import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as db from '../../src/main/services/memoryDb'
import { setReadyPromise } from '../../src/main/services/memory/core'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-changelog-retention-'))

function seed(roleId: string, value: number): void {
  db.recordMemoryChange({
    memoryId: `memory-${roleId}`,
    roleId,
    action: 'update',
    field: 'state',
    oldValue: String(value - 1),
    newValue: String(value),
  })
}

describe('memory changelog retention', () => {
  beforeAll(async () => {
    await db.initMemoryDb(root)
    await db.memoryDbReady()
  })

  afterAll(() => {
    db.closeMemoryDb()
    setReadyPromise(null)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('按角色保留最新记录，不让繁忙角色挤掉其他角色的历史', () => {
    expect(db).toHaveProperty('pruneMemoryChangelog')
    for (let i = 1; i <= 5; i++) seed('alpha', i)
    for (let i = 1; i <= 3; i++) seed('beta', i)

    expect(db.pruneMemoryChangelog(2)).toBe(4)
    expect(db.listRoleMemoryChanges('alpha').map((row) => row.new_value)).toEqual(['5', '4'])
    expect(db.listRoleMemoryChanges('beta').map((row) => row.new_value)).toEqual(['3', '2'])
  })

  it('拒绝无效保留上限，避免误删整份审计历史', () => {
    const before = db.listRoleMemoryChanges('alpha')
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => db.pruneMemoryChangelog(limit)).toThrow(RangeError)
    }
    expect(db.listRoleMemoryChanges('alpha')).toEqual(before)
  })

  it('重启时先快照，再按每角色 1000 条清理审计记录', async () => {
    for (let i = 1; i <= 1002; i++) seed('startup', i)
    db.closeMemoryDb()
    setReadyPromise(null)

    await db.initMemoryDb(root)
    await db.memoryDbReady()

    const day = new Date().toISOString().slice(0, 10)
    const probe = new DatabaseSync(path.join(root, 'backups', `memory-${day}.db`), { readOnly: true })
    try {
      const backup = probe.prepare('SELECT COUNT(*) AS c FROM memory_changelog WHERE role_id = ?').get('startup') as { c: number }
      expect(backup.c).toBe(1002)
    } finally {
      probe.close()
    }
    const retained = db.listRoleMemoryChanges('startup', 1100)
    expect(retained).toHaveLength(1000)
    expect(retained[0].new_value).toBe('1002')
    expect(retained.at(-1)?.new_value).toBe('3')
  })

  it('快照失败时跳过清理，不拿旧备份冒充保险', async () => {
    seed('startup', 1003)
    seed('startup', 1004)
    db.closeMemoryDb()
    setReadyPromise(null)

    const day = new Date().toISOString().slice(0, 10)
    const conflict = path.join(root, 'backups', `memory-${day}.db.tmp`)
    fs.mkdirSync(conflict)
    try {
      await db.initMemoryDb(root)
      await db.memoryDbReady()
      expect(db.listRoleMemoryChanges('startup', 1100)).toHaveLength(1002)
    } finally {
      fs.rmSync(conflict, { recursive: true, force: true })
    }
  })
})
