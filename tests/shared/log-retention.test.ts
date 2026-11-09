import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initLogFile } from '../../src/main/services/logBus'

let dir: string | null = null

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('日志保留', () => {
  it('导演日志只保留最近 30 天文件', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengal-logs-'))
    for (let i = 1; i <= 31; i++) {
      const day = String(i).padStart(2, '0')
      fs.writeFileSync(path.join(dir, `director-202601${day}.ndjson`), '{}\n')
    }
    initLogFile(dir)
    const files = fs.readdirSync(dir).filter((name) => name.startsWith('director-'))
    expect(files).toHaveLength(30)
    expect(files).not.toContain('director-20260101.ndjson')
  })
})
