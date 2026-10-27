import type { IpcResult } from '@shared/types'

export function wrap<T>(run: () => Promise<T> | T): Promise<IpcResult<T>> {
  return Promise.resolve()
    .then(run)
    .then((data) => ({ success: true, data }) as IpcResult<T>)
    .catch((error: Error) => ({ success: false, error: error.message }) as IpcResult<T>)
}
