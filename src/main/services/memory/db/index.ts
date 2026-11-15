import { checkpoint, db, dbFile, logger, openMemoryDb, prepareMemoryDb, readyPromise, setReadyPromise } from './core'
import { migrateLegacyBackups, preUpgradeBackup, snapshotBackup } from './backup'
import { SCHEMA, migrateFactsSchema, migrateMemoryV2, migrateMessagesSchema } from './schema'
import { syncChatHistoryFromJson, syncLegacyMemoryFromJson } from './legacy'
import { pruneMemoryChangelog } from './changelog'
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
export { setMemoryDbLogger, memoryDbReady, closeMemoryDb, withTx, getMeta, setMeta } from './core'
export { migrateMemoryV2 } from './schema'
export { searchTokens, visibleMessageText, searchMessages } from '../store/search'
export * from '../store/messages'
export * from '../store/memories'
export * from '../store/summaries'
export * from './changelog'

export function initMemoryDb(dataRoot: string, backupRoot?: string): Promise<void> {
  if (readyPromise) return readyPromise
  const promise = (async () => {
    prepareMemoryDb(dataRoot, backupRoot)
    migrateLegacyBackups(dataRoot)
    openMemoryDb()
    const check = db!.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
    if (check?.quick_check !== 'ok') {
      throw new Error(`memory.db 完整性检查失败: ${JSON.stringify(check)}`)
    }
    checkpoint()
    if (!preUpgradeBackup()) {
      throw new Error('升级前备份失败，已中止记忆库初始化')
    }
    db!.exec(SCHEMA)
    migrateMessagesSchema()
    migrateFactsSchema()
    migrateMemoryV2()
    checkpoint()
    const snapshotReady = snapshotBackup()
    syncLegacyMemoryFromJson(dataRoot)
    await syncChatHistoryFromJson(dataRoot)
    if (!snapshotReady) {
      logger.warn('memory', '快照失败，已跳过变更审计清理')
    } else {
      const pruned = pruneMemoryChangelog(1000)
      if (pruned > 0) logger.info('memory', `旧变更审计已清理 ${pruned} 条（每角色保留 1000 条）`)
    }
    logger.info('memory', `记忆库已就绪(WAL): ${dbFile}`)
  })().catch((err) => {
    logger.error('memory', `记忆库初始化失败: ${getErrorMessage(err)}`)
    throw err
  })
  setReadyPromise(promise)
  return promise
}

// 进程退出前调用，把 WAL 合并回主库并补一份当日快照
export function flushMemoryDb(): void {
  checkpoint()
  snapshotBackup()
}
