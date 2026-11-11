import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from '../../src/main/services/memoryDb'

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
})
