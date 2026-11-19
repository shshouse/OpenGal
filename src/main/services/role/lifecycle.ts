import fs from 'node:fs'
import path from 'node:path'
import { exportRoleDbSnapshot, invalidateRoleDirCache, sleepRoleDb } from '../memory/db'
import { findRoleFolderById, sanitizeFolderName } from './store'

export function deleteOwnedRole(
  dataRoot: string,
  roleId: string,
  backupRoot?: string,
): boolean {
  const found = findRoleFolderById(dataRoot, roleId)
  if (!found) return false

  const dbPath = path.join(found.rootPath, 'memory.db')
  if (fs.existsSync(dbPath) && backupRoot) {
    const archiveFile = path.join(
      backupRoot,
      'deleted-roles',
      `${sanitizeFolderName(found.name)}-${Date.now()}.db`,
    )
    exportRoleDbSnapshot(roleId, archiveFile)
  }
  sleepRoleDb(roleId)
  fs.rmSync(found.rootPath, { recursive: true, force: true })
  invalidateRoleDirCache()
  return true
}

function copyDirectoryFiltered(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.endsWith('.db-wal') || entry.name.endsWith('.db-shm') || entry.name.endsWith('.bak')) {
      continue
    }
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      copyDirectoryFiltered(srcPath, destPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/** 导出完整可迁移角色文件夹：先合并清空 WAL，再完整复制整个单角色目录 */
export function exportOwnedRoleFolder(
  dataRoot: string,
  roleId: string,
  destinationParentDir: string,
): string {
  const found = findRoleFolderById(dataRoot, roleId)
  if (!found) throw new Error('未找到要导出的角色目录')

  sleepRoleDb(roleId)
  fs.mkdirSync(destinationParentDir, { recursive: true })
  const targetDir = path.join(destinationParentDir, found.name)
  if (fs.existsSync(targetDir)) {
    throw new Error(`目标位置已存在同名文件夹：${found.name}`)
  }
  copyDirectoryFiltered(found.rootPath, targetDir)
  return targetDir
}
