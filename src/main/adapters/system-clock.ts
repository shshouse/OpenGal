import type { Clock } from '@shared/ports'

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now()
  }

  monotonic(): number {
    return performance.now()
  }

  timeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, Math.max(0, ms))
      const onAbort = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(abortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}
