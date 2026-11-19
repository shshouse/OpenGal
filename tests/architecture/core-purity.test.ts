import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CORE_DIR = path.resolve(process.cwd(), 'src/core')
const FORBIDDEN_IMPORTS = [
  /from\s+['"]electron['"]/,
  /from\s+['"]node:(?:fs|sqlite|child_process|net|http|https)['"]/,
  /from\s+['"]react['"]/,
  /from\s+['"]@main\//,
  /from\s+['"]@\//,
]

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectTsFiles(full))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('src/core 跨端纯净度守卫', () => {
  it('不依赖 electron、node 原生 IO、react 或宿主层模块', () => {
    const files = collectTsFiles(CORE_DIR)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8')
      for (const pattern of FORBIDDEN_IMPORTS) {
        expect(content, `${path.relative(CORE_DIR, file)} 命中了禁用依赖 ${pattern}`).not.toMatch(pattern)
      }
    }
  })
})
