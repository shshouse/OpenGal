import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from '../../src/main/services/memoryDb'
import * as store from '../../src/main/services/memoryStore'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-prune-'))

const { pruneOverflow } = store as unknown as {
  pruneOverflow?: (characterId: string, limit?: number) => Promise<{ archived: number }>
}

function seed(id: string, importance: number, pinned = false, kind = 'fact') {
  db.insertMemoryRow('c-prune', {
    id,
    character_id: 'c-prune',
    kind,
    text: `记忆 ${id}`,
    state: 'active',
    importance,
    happened_at: null,
    created_at: Number(id.replace(/\D/g, '')) || 1,
    source_from: null,
    source_to: null,
    supersedes: null,
    pinned: pinned ? 1 : 0,
    embedding: null,
  })
}

describe('记忆归档', () => {
  beforeAll(async () => {
    await db.initMemoryDb(root)
    await db.memoryDbReady()
  })

  afterAll(() => {
    db.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('超过上限时保留钉住的与最重要的，归档其余', async () => {
    expect(pruneOverflow).toBeTypeOf('function')
    seed('m1', 1)
    seed('m2', 5)
    seed('m3', 3)
    seed('m4', 1, true)
    seed('s1', 1, false, 'event')

    const result = await pruneOverflow!('c-prune', 3)
    expect(result.archived).toBe(2)

    const active = db.listMemoryRows('c-prune').map((row) => row.id).sort()
    expect(active).toEqual(['m2', 'm3', 'm4'])

    const all = db.listMemoryRows('c-prune', { includeInactive: true })
    expect(all.filter((row) => row.state === 'archived').map((row) => row.id).sort()).toEqual(['m1', 's1'])
  })

  it('未超过上限时不动任何记忆', async () => {
    const result = await pruneOverflow!('c-prune', 100)
    expect(result.archived).toBe(0)
  })
})
