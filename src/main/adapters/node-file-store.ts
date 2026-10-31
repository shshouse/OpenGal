import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileStat, FileStore, ListOptions, RemoveOptions } from '@shared/ports'

export interface FileStoreRoots {
  dataDir(): string
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class NodeFileStore implements FileStore {
  constructor(private readonly roots: FileStoreRoots) {}

  dataDir(): string {
    return this.roots.dataDir()
  }

  tempDir(): string {
    return path.join(this.dataDir(), 'tmp')
  }

  resolve(...parts: string[]): string {
    return path.resolve(this.dataDir(), ...parts)
  }

  async readText(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8')
  }

  async readBytes(filePath: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(filePath))
  }

  async writeText(filePath: string, data: string): Promise<void> {
    await this.ensureParent(filePath)
    await fs.writeFile(filePath, data, 'utf-8')
  }

  async writeBytes(filePath: string, data: Uint8Array): Promise<void> {
    await this.ensureParent(filePath)
    await fs.writeFile(filePath, data)
  }

  async appendText(filePath: string, data: string): Promise<void> {
    await this.ensureParent(filePath)
    await fs.appendFile(filePath, data, 'utf-8')
  }

  async atomicWrite(filePath: string, data: string | Uint8Array): Promise<void> {
    await this.ensureParent(filePath)
    const tempPath = `${filePath}.${randomUUID()}.tmp`
    try {
      if (typeof data === 'string') await fs.writeFile(tempPath, data, 'utf-8')
      else await fs.writeFile(tempPath, data)
      await this.replaceFile(tempPath, filePath)
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => {})
    }
  }

  async remove(target: string, options?: RemoveOptions): Promise<void> {
    await fs.rm(target, { recursive: options?.recursive ?? false, force: true })
  }

  async rename(from: string, to: string): Promise<void> {
    await this.ensureParent(to)
    await this.replaceFile(from, to)
  }

  async stat(target: string): Promise<FileStat | null> {
    try {
      const result = await fs.stat(target)
      return { size: result.size, mtimeMs: result.mtimeMs, isDirectory: result.isDirectory() }
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async list(dir: string, options?: ListOptions): Promise<string[]> {
    const found: string[] = []
    const pending = [dir]
    while (pending.length > 0) {
      const current = pending.pop() as string
      let entries
      try {
        entries = await fs.readdir(current, { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) continue
        throw error
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        found.push(full)
        if (options?.recursive && entry.isDirectory()) pending.push(full)
      }
    }
    return found.sort()
  }

  private async ensureParent(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
  }

  // Windows 上 rename 覆盖已存在文件会失败，先删再重命名；两步都在同目录内完成
  private async replaceFile(from: string, to: string): Promise<void> {
    try {
      await fs.rename(from, to)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') throw error
      await fs.rm(to, { force: true })
      await fs.rename(from, to)
    }
  }
}
