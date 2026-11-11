import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { appendMessage, closeMemoryDb, flushMemoryDb, initMemoryDb, memoryDbReady } from '../../src/main/services/memoryDb'
import { pruneBackups } from '../../src/main/services/memory/backup'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-memory-backup-'))

afterAll(() => {
  closeMemoryDb()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('memory backup', () => {
  it('flush 后产出可打开且通过校验的每日快照', async () => {
    await initMemoryDb(root)
    await memoryDbReady()
    appendMessage({ role_id: 'c', role: 'user', content: '内容', ts: 1, archived: 0 })

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

  it('按类别保留备份，未知文件不删', () => {
    const dir = path.join(root, 'retention')
    fs.mkdirSync(dir)
    const daily = Array.from({ length: 9 }, (_, i) => `memory-2026-01-${String(i + 1).padStart(2, '0')}.db`)
    const migrations = Array.from({ length: 5 }, (_, i) => `memory-pre-v${i}-2026-01-01.db`)
    for (const [index, name] of [...daily, ...migrations, 'do-not-touch.db'].entries()) {
      const file = path.join(dir, name)
      fs.writeFileSync(file, name)
      fs.utimesSync(file, new Date(index * 1000), new Date(index * 1000))
    }

    expect(pruneBackups(dir)).toBe(4)
    expect(fs.readdirSync(dir).sort()).toEqual([...daily.slice(2), ...migrations.slice(2), 'do-not-touch.db'].sort())
  })
})
