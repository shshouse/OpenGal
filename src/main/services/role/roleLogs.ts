import fs from 'node:fs'
import path from 'node:path'
import { resolveRoleDbDir } from '../memory/db/core'

export interface RoleLogRecord {
  ts: number
  level: 'info' | 'warn' | 'error'
  scope: string
  message: string
  detail?: string
}

const LOG_FILE_NAME = 'role.jsonl'
const MAX_ROLE_LOG_BYTES = 2 * 1024 * 1024
const LF = String.fromCharCode(10)

export function appendRoleLog(
  roleId: string,
  entry: Omit<RoleLogRecord, 'ts'> & { ts?: number },
): void {
  const { roleDir } = resolveRoleDbDir(roleId)
  if (!fs.existsSync(roleDir)) return
  try {
    const logsDir = path.join(roleDir, 'logs')
    fs.mkdirSync(logsDir, { recursive: true })
    const logFile = path.join(logsDir, LOG_FILE_NAME)
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_ROLE_LOG_BYTES) {
      const lines = fs.readFileSync(logFile, 'utf-8').trim().split(LF)
      fs.writeFileSync(logFile, lines.slice(-500).join(LF) + LF, 'utf-8')
    }
    const record: RoleLogRecord = {
      ts: entry.ts ?? Date.now(),
      level: entry.level,
      scope: entry.scope,
      message: entry.message,
      ...(entry.detail ? { detail: entry.detail } : {}),
    }
    fs.appendFileSync(logFile, JSON.stringify(record) + LF, 'utf-8')
  } catch {
    // 角色单目录日志写失败不阻塞主流程
  }
}
