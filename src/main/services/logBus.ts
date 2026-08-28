import type { WebContents } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type { LogEntry, LogLevel } from '@shared/log'

const MAX_ENTRIES = 2000

const buffer: LogEntry[] = []
const subscribers = new Set<WebContents>()
let seq = 0

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
