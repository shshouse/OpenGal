import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfigDir } from '../../src/main/services/configMigration'

const roots: string[] = []

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengal-config-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('配置目录迁移', () => {
  it('首次启动复制旧配置，旧文件保留', () => {
    const root = tempRoot()
    const legacy = path.join(root, 'data')
    const preferred = path.join(root, 'appdata')
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'opengal-config.json'), '{"theme":"dark"}')

    const result = resolveConfigDir(preferred, legacy)
    expect(result).toMatchObject({ dir: preferred, migrated: true })
    expect(fs.readFileSync(path.join(preferred, 'opengal-config.json'), 'utf-8')).toBe('{"theme":"dark"}')
    expect(fs.existsSync(path.join(legacy, 'opengal-config.json'))).toBe(true)
  })

  it('新目录已有配置时不覆盖', () => {
    const root = tempRoot()
    const legacy = path.join(root, 'data')
    const preferred = path.join(root, 'appdata')
    fs.mkdirSync(legacy, { recursive: true })
    fs.mkdirSync(preferred, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'opengal-config.json'), 'old')
    fs.writeFileSync(path.join(preferred, 'opengal-config.json'), 'new')

    const result = resolveConfigDir(preferred, legacy)
    expect(result).toMatchObject({ dir: preferred, migrated: false })
    expect(fs.readFileSync(path.join(preferred, 'opengal-config.json'), 'utf-8')).toBe('new')
  })

  it('没有旧配置时使用新目录', () => {
    const root = tempRoot()
    const result = resolveConfigDir(path.join(root, 'appdata'), path.join(root, 'data'))
    expect(result).toMatchObject({ dir: path.join(root, 'appdata'), migrated: false })
  })

  it('复制失败时回退旧目录', () => {
    const root = tempRoot()
    const legacy = path.join(root, 'data')
    const preferred = path.join(root, 'blocked')
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'opengal-config.json'), 'old')
    fs.writeFileSync(preferred, 'not a directory')

    const result = resolveConfigDir(preferred, legacy)
    expect(result.dir).toBe(legacy)
    expect(result.error).toBeTruthy()
  })
})
