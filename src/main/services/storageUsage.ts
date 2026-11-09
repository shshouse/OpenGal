import fs from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import type { StorageUsage } from '@shared/storage'
import { getBackupRoot, getDataRoot, getPreferenceRoot } from './paths'

export type { StorageUsage }

async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      total += await dirSize(full)
      continue
    }
    try {
      total += (await fs.stat(full)).size
    } catch {
      // 读取中被删的文件不计入
    }
  }
  return total
}

async function memorySize(dataRoot: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await fs.readdir(dataRoot, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('memory.db')) continue
    try {
      total += (await fs.stat(path.join(dataRoot, entry.name))).size
    } catch {
      // 忽略瞬时文件
    }
  }
  return total
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const dataRoot = getDataRoot()
  const preferenceRoot = getPreferenceRoot()
  const [memory, roles, logs, cache, preferences, backups] = await Promise.all([
    memorySize(dataRoot),
    dirSize(path.join(dataRoot, 'roles')),
    dirSize(path.join(dataRoot, 'logs')),
    dirSize(path.join(dataRoot, 'cache')),
    dirSize(preferenceRoot),
    dirSize(getBackupRoot()),
  ])
  return {
    dataRoot,
    preferenceRoot,
    memory,
    roles,
    logs,
    cache,
    preferences,
    backups,
    total: memory + roles + logs + cache + preferences + backups,
  }
}

export async function revealDataRoot(): Promise<void> {
  const failure = await shell.openPath(getDataRoot())
  if (failure) throw new Error(failure)
}
