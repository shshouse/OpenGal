import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  backupRootDir,
  listOpenRoleHandles,
  logger,
  openRoleDb,
  sanitizeRoleFolderName,
  type RoleDbHandle,
} from './core'
import { getErrorMessage } from '@shared/app/errors'

export function verifyDbFile(file: string, requiredTable?: string): boolean {
  try {
    const probe = new DatabaseSync(file, { readOnly: true })
    try {
      const check = probe.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
      if (check?.quick_check !== 'ok') return false
      if (!requiredTable) return true
      const table = probe
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(requiredTable)
      return !!table
    } finally {
      probe.close()
    }
  } catch {
    return false
  }
}

export function snapshotHandleTo(handle: RoleDbHandle, targetFile: string, requiredTable?: string): boolean {
  try {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true })
    if (fs.existsSync(targetFile)) {
      if (fs.statSync(targetFile).isDirectory()) {
        logger.error('memory', `快照目标路径为目录，拒绝覆盖 (${handle.roleId}): ${targetFile}`)
        return false
      }
      fs.rmSync(targetFile, { force: true })
    }
    handle.port.exec(`VACUUM INTO '${targetFile.replace(/'/g, "''")}'`)
    if (!verifyDbFile(targetFile, requiredTable)) {
      fs.rmSync(targetFile, { force: true })
      logger.error('memory', `备份校验失败，已删除: ${targetFile}`)
      return false
    }
    return true
  } catch (err) {
    logger.error('memory', `快照生成失败 (${handle.roleId}): ${getErrorMessage(err)}`)
    try {
      if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
        fs.rmSync(targetFile, { force: true })
      }
    } catch {
      /* ignore cleanup error */
    }
    return false
  }
}

export function exportRoleDbSnapshot(roleId: string, targetFile: string): boolean {
  const handle = openRoleDb(roleId)
  return snapshotHandleTo(handle, targetFile, 'messages')
}

const BACKUP_RETENTION = [
  { pattern: /^memory-\d{4}-\d{2}-\d{2}\.db$/, keep: 7 },
  { pattern: /^memory-pre-.*\.db$/, keep: 3 },
]

export function pruneBackups(root = backupRootDir): number {
  let removed = 0
  if (!root || !fs.existsSync(root)) return 0
  try {
    const names = fs.readdirSync(root)
    for (const { pattern, keep } of BACKUP_RETENTION) {
      const files = names
        .filter((name) => pattern.test(name))
        .map((name) => path.join(root, name))
        .filter((file) => fs.statSync(file).isFile())
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      for (const file of files.slice(keep)) {
        fs.rmSync(file, { force: true })
        removed++
      }
    }
  } catch (err) {
    logger.warn('memory', `旧备份清理失败: ${getErrorMessage(err)}`)
  }
  return removed
}

export function snapshotRoleBackup(roleId: string): boolean {
  const handle = openRoleDb(roleId)
  return snapshotHandleBackup(handle)
}

function snapshotHandleBackup(handle: RoleDbHandle): boolean {
  try {
    if (!fs.existsSync(handle.dbFile) || fs.statSync(handle.dbFile).size === 0) return false
    const roleBackupDir = path.join(backupRootDir, 'roles', sanitizeRoleFolderName(handle.folderName || handle.roleId))
    fs.mkdirSync(roleBackupDir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    const target = path.join(roleBackupDir, `memory-${day}.db`)
    const tmp = `${target}.tmp`
    if (!snapshotHandleTo(handle, tmp, 'messages')) return false
    fs.rmSync(target, { force: true })
    fs.renameSync(tmp, target)
    pruneBackups(roleBackupDir)
    return true
  } catch (err) {
    logger.error('memory', `角色备份失败 (${handle.roleId}): ${getErrorMessage(err)}`)
    return false
  }
}

export function snapshotBackup(roleId?: string): boolean {
  if (roleId) return snapshotRoleBackup(roleId)
  const handles = listOpenRoleHandles().filter((h) => h.roleId !== '_system')
  if (handles.length === 0) return true
  let allOk = true
  for (const handle of handles) {
    if (!snapshotHandleBackup(handle)) allOk = false
  }
  return allOk
}
