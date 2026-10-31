import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PORTS_DIR = path.resolve(process.cwd(), 'src/shared/ports')
const FORBIDDEN = [/(?:from|import)\s+['"]node:/, /(?:from|import)\s+['"]electron['"]/, /(?:from|import)\s+['"]@main\//]

describe('ports 边界', () => {
  it('端口层不得依赖 Node、Electron 或 main', async () => {
    const files = (await fs.readdir(PORTS_DIR)).filter((name) => name.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const name of files) {
      const source = await fs.readFile(path.join(PORTS_DIR, name), 'utf-8')
      if (FORBIDDEN.some((pattern) => pattern.test(source))) offenders.push(name)
    }
    expect(offenders).toEqual([])
  })
})
