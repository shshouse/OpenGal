/**
 * SQLite 执行端口。
 *
 * SQL 留在核心；适配层只负责执行与事务，不提供 ORM。
 * 端口为异步：移动端 SQLite 驱动没有同步 API。
 */
export type SqlValue = string | number | null | Uint8Array

export interface RunResult {
  changes: number
  lastInsertId: number
}

export interface Database {
  exec(sql: string): Promise<void>
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>
  run(sql: string, params?: SqlValue[]): Promise<RunResult>
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>
  close(): Promise<void>
  /** 可选：桌面用 VACUUM INTO，移动端可缺失 */
  backupTo?(path: string): Promise<void>
}
