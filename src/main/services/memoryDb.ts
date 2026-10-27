import { checkpoint, db, dbFile, logger, openMemoryDb, prepareMemoryDb, readyPromise, setReadyPromise } from './memory/core'
import { migrateLegacyBackups, preUpgradeBackup, snapshotBackup } from './memory/backup'
import { SCHEMA, migrateFactsSchema, migrateMessagesSchema } from './memory/schema'
import { syncChatHistoryFromJson, syncLegacyMemoryFromJson } from './memory/legacy'

export type {
  MessageRow,
  MemoryRow,
  FactRow,
  StoryRow,
  SummaryRow,
  MessageSearchOptions,
  MemoryDbLogger,
} from './memory/types'
export { setMemoryDbLogger, memoryDbReady, closeMemoryDb, withTx, getMeta, setMeta } from './memory/core'
export { searchTokens, visibleMessageText, searchMessages } from './memory/search'
export * from './memory/messages'
export * from './memory/memories'
export * from './memory/summaries'

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
    checkpoint()
    snapshotBackup()
    syncLegacyMemoryFromJson(dataRoot)
    await syncChatHistoryFromJson(dataRoot)
    logger.info('memory', `记忆库已就绪(WAL): ${dbFile}`)
  })().catch((err) => {
    logger.error('memory', `记忆库初始化失败: ${(err as Error).message}`)
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
