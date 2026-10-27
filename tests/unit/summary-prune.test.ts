import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from '../../src/main/services/memoryDb'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-summary-prune-'))

const api = db as unknown as {
  pruneSummaries?: (characterId: string, keep?: number) => number
}

describe('摘要清理', () => {
  beforeAll(async () => {
    await db.initMemoryDb(root)
    await db.memoryDbReady()
    for (let i = 1; i <= 12; i++) {
      db.addSummary('c-sum', {
        start_ts: i * 1000,
        end_ts: i * 1000 + 500,
        text: `第 ${i} 段`,
        message_count: 2,
      })
    }
  })

  afterAll(() => {
    db.closeMemoryDb()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('只保留最近若干条，删除更旧的', () => {
    expect(api.pruneSummaries).toBeTypeOf('function')
    expect(api.pruneSummaries!('c-sum', 5)).toBe(7)
    const left = db.listSummaries('c-sum')
    expect(left).toHaveLength(5)
    expect(left.map((s) => s.text).sort()).toEqual(
      ['第 10 段', '第 11 段', '第 12 段', '第 8 段', '第 9 段'].sort(),
    )
  })

  it('未超过保留数时不动', () => {
    expect(api.pruneSummaries!('c-sum', 50)).toBe(0)
    expect(db.listSummaries('c-sum')).toHaveLength(5)
  })
})
