import type { WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IpcChannels } from '@shared/ipc-channels'
import type { LogEntry, LogLevel } from '@shared/log'

const MAX_ENTRIES = 2000
const MAX_LOG_FILES = 14

const buffer: LogEntry[] = []
const subscribers = new Set<WebContents>()
let seq = 0
let logDir: string | null = null

// 日志落盘到 <dataRoot>/logs/app-YYYYMMDD.ndjson，保留最近 14 天；
// 崩溃或强退后仍能追溯，内存缓冲只负责实时展示。
export function initLogFile(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
    logDir = dir
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^app-\d{8}\.ndjson$/.test(f))
      .sort()
    while (files.length > MAX_LOG_FILES) {
      fs.rmSync(path.join(dir, files.shift() as string), { force: true })
    }
  } catch {
    logDir = null
  }
}

function appendToFile(entry: LogEntry): void {
  if (!logDir) return
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  fs.promises
    .appendFile(path.join(logDir, `app-${day}.ndjson`), `${JSON.stringify(entry)}\n`, 'utf-8')
    .catch(() => {})
}

function nextId(): string {
  seq += 1
  return `${Date.now().toString(36)}-${seq.toString(36)}`
}

function broadcast(entry: LogEntry): void {
  for (const wc of subscribers) {
    if (wc.isDestroyed()) {
      subscribers.delete(wc)
      continue
    }
    try {
      wc.send(IpcChannels.logs.entry, entry)
    } catch {
      // ignore: 接收方崩了不影响其他订阅者
    }
  }
}

export function addLogSubscriber(wc: WebContents): void {
  subscribers.add(wc)
  wc.once('destroyed', () => subscribers.delete(wc))
}

export function getAllLogs(): LogEntry[] {
  return buffer.slice()
}

export function clearLogs(): void {
  buffer.length = 0
}

function push(level: LogLevel, source: string, message: string, details?: string): void {
  const entry: LogEntry = {
    id: nextId(),
    timestamp: Date.now(),
    level,
    source,
    message,
    details,
  }
  buffer.push(entry)
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  const line = `[${level}] [${source}] ${message}`
  if (level === 'error') console.error(details ? `${line}\n${details}` : line)
  else console.log(details ? `${line}\n${details}` : line)
  appendToFile(entry)
  broadcast(entry)
}

export const logBus = {
  debug: (source: string, message: string, details?: string): void =>
    push('debug', source, message, details),
  info: (source: string, message: string, details?: string): void =>
    push('info', source, message, details),
  warn: (source: string, message: string, details?: string): void =>
    push('warn', source, message, details),
  error: (source: string, message: string, details?: string): void =>
    push('error', source, message, details),
}
