import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { backupRootDir, db, dbFile, logger, rows } from './core'

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
    logger.warn('memory', `旧备份迁移失败（不影响主库）: ${(err as Error).message}`)
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
    logger.error('memory', `备份生成失败: ${(err as Error).message}`)
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
    logger.error('memory', `升级前备份失败: ${(err as Error).message}`)
    return false
  }
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
    const all = fs
      .readdirSync(backupRootDir)
      .filter((f) => /^memory-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
    while (all.length > 7) fs.rmSync(path.join(backupRootDir, all.shift() as string), { force: true })
  } catch (err) {
    logger.error('memory', `备份失败: ${(err as Error).message}`)
  }
}
