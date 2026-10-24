import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { appendMessage, closeMemoryDb, flushMemoryDb, initMemoryDb, memoryDbReady } from '../../src/main/services/memoryDb'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-backup-'))

afterAll(() => {
  closeMemoryDb()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('memory backup', () => {
  it('flush 后产出可打开且通过校验的每日快照', async () => {
    await initMemoryDb(root)
    await memoryDbReady()
    appendMessage({ character_id: 'c', role: 'user', content: '内容', ts: 1, archived: 0 })

    flushMemoryDb()

    const day = new Date().toISOString().slice(0, 10)
    const file = path.join(root, 'backups', `memory-${day}.db`)
    expect(fs.existsSync(file)).toBe(true)

    const probe = new DatabaseSync(file, { readOnly: true })
    try {
      const check = probe.prepare('PRAGMA quick_check').get() as { quick_check?: string }
      expect(check.quick_check).toBe('ok')
      const rows = probe.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }
      expect(rows.n).toBe(1)
    } finally {
      probe.close()
    }
  })
})
