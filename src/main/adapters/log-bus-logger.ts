import type { LogFields, Logger } from '@shared/ports'
import { logBus } from '../services/logBus'

function detail(fields?: LogFields): string | undefined {
  if (!fields) return undefined
  try {
    return JSON.stringify(fields)
  } catch {
    return '[unserializable fields]'
  }
}

export class LogBusLogger implements Logger {
  debug(source: string, message: string, fields?: LogFields): void {
    logBus.debug(source, message, detail(fields))
  }

  info(source: string, message: string, fields?: LogFields): void {
    logBus.info(source, message, detail(fields))
  }

  warn(source: string, message: string, fields?: LogFields): void {
    logBus.warn(source, message, detail(fields))
  }

  error(source: string, message: string, fields?: LogFields): void {
    logBus.error(source, message, detail(fields))
  }
}
