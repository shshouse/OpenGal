import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { backupRootDir, db, dbFile, logger, rows } from './core'
import { getErrorMessage } from '@shared/errors'

// 旧版备份留在 data/backups：首次启动时复制到新备份目录，原文件保留不动
export function migrateLegacyBackups(dataRoot: string): void {
  try {
    const legacy = path.join(dataRoot, 'backups')
    if (path.resolve(legacy) === path.resolve(backupRootDir) || !fs.existsSync(legacy)) return
    for (const name of fs.readdirSync(legacy)) {
      if (!/^memory-.*\.db$/.test(name)) continue
      const target = path.join(backupRootDir, name)
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(legacy, name), target)
    }
    logger.info('memory', `旧备份已复制到 ${backupRootDir}（原文件保留）`)
  } catch (err) {
    logger.warn('memory', `旧备份迁移失败（不影响主库）: ${getErrorMessage(err)}`)
  }
}

// 复制后立刻校验，坏备份等于没有备份
function verifyDbFile(file: string, requiredTable?: string): boolean {
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

function hasTable(name: string): boolean {
  return rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]).length > 0
}

// WAL 模式下直接复制主库会漏掉未 checkpoint 的数据；用 SQLite 自己的快照保证一致
export function sqliteSnapshot(target: string, requiredTable?: string): boolean {
  if (!db) return false
  try {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true })
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    if (!verifyDbFile(target, requiredTable)) {
      fs.rmSync(target, { force: true })
      logger.error('memory', `备份校验失败，已删除: ${target}`)
      return false
    }
    return true
  } catch (err) {
    logger.error('memory', `备份生成失败: ${getErrorMessage(err)}`)
    fs.rmSync(target, { force: true })
    return false
  }
}

// 在改表结构之前做一致性备份；备份失败必须阻断后续迁移
export function preUpgradeBackup(): boolean {
  try {
    if (!hasTable('messages')) return true
    const target = path.join(backupRootDir, 'memory-pre-upgrade.db')
    if (fs.existsSync(target)) {
      if (verifyDbFile(target, 'messages')) return true
      fs.rmSync(target, { force: true })
    }
    if (!sqliteSnapshot(target, 'messages')) return false
    logger.info('memory', `已创建升级前备份: ${target}`)
    return true
  } catch (err) {
    logger.error('memory', `升级前备份失败: ${getErrorMessage(err)}`)
    return false
  }
}

// 每次结构迁移前都生成一份新的带时间戳快照：pre-upgrade 只保留首次的，
// 重复升级时不能拿几个月前的备份当保险
export function backupBeforeMigration(label: string): string | null {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = path.join(backupRootDir, `memory-pre-${label}-${stamp}.db`)
    if (!sqliteSnapshot(target, 'messages')) return null
    logger.info('memory', `迁移前备份: ${target}`)
    pruneBackups()
    return target
  } catch (err) {
    logger.error('memory', `迁移前备份失败: ${getErrorMessage(err)}`)
    return null
  }
}

// 每类备份各自的保留份数；不落入任何一类就不删，宁可留着
const BACKUP_RETENTION = [
  { pattern: /^memory-\d{4}-\d{2}-\d{2}\.db$/, keep: 7 },
  { pattern: /^memory-pre-.*\.db$/, keep: 3 },
]

export function pruneBackups(root = backupRootDir): number {
  let removed = 0
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

export function snapshotBackup(): void {
  try {
    if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size === 0) return
    const day = new Date().toISOString().slice(0, 10)
    const target = path.join(backupRootDir, `memory-${day}.db`)
    const tmp = `${target}.tmp`
    if (!sqliteSnapshot(tmp)) return
    fs.rmSync(target, { force: true })
    fs.renameSync(tmp, target)
    pruneBackups()
  } catch (err) {
    logger.error('memory', `备份失败: ${getErrorMessage(err)}`)
  }
}
