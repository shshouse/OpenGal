export type SqlParam = string | number | bigint | Uint8Array | null

export interface SqlRunResult {
  changes: number
  lastInsertRowid: number
}

export interface RoleDatabasePort {
  exec(sql: string): void
  run(sql: string, params?: readonly SqlParam[]): SqlRunResult
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T[]
  transaction<T>(fn: () => T): T
  checkpoint(): void
  close(): void
}
