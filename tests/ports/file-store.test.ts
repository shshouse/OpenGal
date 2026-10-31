import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NodeFileStore } from '../../src/main/adapters/node-file-store'

let root: string
let store: NodeFileStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'opengal-fs-'))
  store = new NodeFileStore({ dataDir: () => root })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('NodeFileStore', () => {
  it('原子写入后可读回文本与字节', async () => {
    const file = store.resolve('nested', 'a.txt')
    await store.atomicWrite(file, 'hello')
    await expect(store.readText(file)).resolves.toBe('hello')
    await store.writeBytes(store.resolve('nested', 'b.bin'), new Uint8Array([1, 2, 3]))
    await expect(store.readBytes(store.resolve('nested', 'b.bin'))).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })

  it('stat 对不存在的路径返回 null', async () => {
    await expect(store.stat(store.resolve('missing.txt'))).resolves.toBeNull()
    await store.writeText(store.resolve('here.txt'), 'x')
    const stat = await store.stat(store.resolve('here.txt'))
    expect(stat?.isDirectory).toBe(false)
    expect(stat?.size).toBe(1)
  })

  it('递归 list 返回绝对路径且不存在时为空', async () => {
    await store.writeText(store.resolve('dir', 'one.txt'), '1')
    await store.writeText(store.resolve('dir', 'sub', 'two.txt'), '2')
    const recursive = await store.list(store.resolve('dir'), { recursive: true })
    expect(recursive).toContain(store.resolve('dir', 'one.txt'))
    expect(recursive).toContain(store.resolve('dir', 'sub', 'two.txt'))
    await expect(store.list(store.resolve('nope'), { recursive: true })).resolves.toEqual([])
  })

  it('rename 覆盖已存在文件', async () => {
    const from = store.resolve('from.txt')
    const to = store.resolve('to.txt')
    await store.writeText(from, 'new')
    await store.writeText(to, 'old')
    await store.rename(from, to)
    await expect(store.readText(to)).resolves.toBe('new')
    await expect(store.stat(from)).resolves.toBeNull()
  })

  it('remove 支持递归删除', async () => {
    await store.writeText(store.resolve('dir', 'a.txt'), 'a')
    await store.remove(store.resolve('dir'), { recursive: true })
    await expect(store.stat(store.resolve('dir'))).resolves.toBeNull()
  })
})
