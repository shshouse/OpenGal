import fs from 'node:fs'
import path from 'node:path'
import {
  checkpoint,
  closeMemoryDb,
  dataRootDir,
  getMeta,
  getRoleMeta,
  invalidateRoleDirCache,
  listOpenRoleHandles,
  logger,
  memoryDbReady,
  openRoleDb,
  prepareMemoryDb,
  readyPromise,
  resolveRoleDbDir,
  setMemoryDbLogger,
  setMeta,
  setReadyPromise,
  setRoleMeta,
  sleepRoleDb,
} from './core'
import { exportRoleDbSnapshot, pruneBackups, snapshotBackup, snapshotRoleBackup } from './backup'
import { pruneMemoryChangelog } from './changelog'
import { importLegacyGlobalMemoryDb } from './legacyImport'
import { ROLE_DB_SCHEMA_VERSION, RoleDbVersionError } from './schema'
import { getErrorMessage } from '@shared/app/errors'

export type {
  MessageRow,
  MemoryRow,
  FactRow,
  StoryRow,
  SummaryRow,
  MessageSearchOptions,
  MemoryDbLogger,
} from '../model/types'
export {
  setMemoryDbLogger,
  memoryDbReady,
  closeMemoryDb,
  openRoleDb,
  sleepRoleDb,
  resolveRoleDbDir,
  invalidateRoleDirCache,
  importLegacyGlobalMemoryDb,
  getMeta,
  setMeta,
  getRoleMeta,
  setRoleMeta,
  listOpenRoleHandles,
}
export {
  exportRoleDbSnapshot,
  pruneBackups,
  snapshotBackup,
  snapshotRoleBackup,
  ROLE_DB_SCHEMA_VERSION,
  RoleDbVersionError,
}
export { searchTokens, visibleMessageText, searchMessages } from '../store/search'
export * from '../store/messages'
export * from '../store/memories'
export * from '../store/summaries'
export * from '../store/roleState'
export * from './changelog'

function maintainExistingRoleDbs(): void {
  const rolesRoot = path.join(dataRootDir, 'roles')
  if (!fs.existsSync(rolesRoot)) return
  for (const entry of fs.readdirSync(rolesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '_system') continue
    const dbFile = path.join(rolesRoot, entry.name, 'memory.db')
    if (!fs.existsSync(dbFile)) continue
    try {
      const handle = openRoleDb(entry.name)
      const changeCount = Number(
        handle.port.query<{ c: number }>('SELECT COUNT(*) AS c FROM memory_changelog')[0]?.c ?? 0,
      )
      if (changeCount > 1000) {
        if (snapshotRoleBackup(handle.roleId)) {
          pruneMemoryChangelog(1000, handle.roleId)
        }
      }
      sleepRoleDb(handle.roleId)
    } catch (err) {
      logger.warn('memory', `启动维护跳过角色库 (${entry.name}): ${getErrorMessage(err)}`)
    }
  }
}

export function initMemoryDb(dataRoot: string, backupRoot?: string): Promise<void> {
  if (readyPromise) return readyPromise
  const promise = (async () => {
    prepareMemoryDb(dataRoot, backupRoot)
    importLegacyGlobalMemoryDb(dataRoot)
    maintainExistingRoleDbs()
    logger.info('memory', `单角色独立记忆库池已就绪 (schema v${ROLE_DB_SCHEMA_VERSION}): ${dataRoot}/roles`)
  })().catch((err) => {
    logger.error('memory', `记忆库池初始化失败: ${getErrorMessage(err)}`)
    throw err
  })
  setReadyPromise(promise)
  return promise
}

export function flushMemoryDb(): void {
  checkpoint()
  if (snapshotBackup()) {
    pruneMemoryChangelog(1000)
  }
}
