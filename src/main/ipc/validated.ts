import { ipcMain } from 'electron'
import { z } from 'zod'
import { wrap } from './wrap'

type Infer<S> = { [K in keyof S]: S[K] extends z.ZodTypeAny ? z.infer<S[K]> : never }

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('；')
}

function parseArgs<S extends z.ZodTypeAny[]>(schemas: [...S], raw: unknown[]): Infer<S> {
  const args = schemas.map((schema, i) => {
    const result = schema.safeParse(raw[i])
    if (!result.success) {
      throw new Error(`参数不合法（第 ${i + 1} 个参数：${formatIssues(result.error)}）`)
    }
    return result.data
  })
  return args as Infer<S>
}

/**
 * 带参数校验的 ipcMain.handle。
 * schemas 与 handler 的参数一一对应；任一不通过时返回「参数不合法」，不进入业务函数。
 * 跨进程边界的入参是运行时数据，TypeScript 标注在这里不生效。
 */
export function handleValidated<Schemas extends z.ZodTypeAny[]>(
  channel: string,
  schemas: [...Schemas],
  fn: (...args: Infer<Schemas>) => unknown,
): void {
  ipcMain.handle(channel, (_event, ...raw: unknown[]) => wrap(() => fn(...parseArgs(schemas, raw))))
}

/** 同上，但 handler 需要访问 event（取 sender 弹窗等场景）。 */
export function handleValidatedWithEvent<Schemas extends z.ZodTypeAny[]>(
  channel: string,
  schemas: [...Schemas],
  fn: (event: Electron.IpcMainInvokeEvent, ...args: Infer<Schemas>) => unknown,
): void {
  ipcMain.handle(channel, (event, ...raw: unknown[]) =>
    wrap(() => fn(event, ...parseArgs(schemas, raw))),
  )
}

/**
 * 不走 IpcResult 包装的变体：fn 自己负责返回值结构与错误处理。
 * 用于流式响应、插件开关等已经有自己返回约定的通道。
 */
export function handleValidatedRaw<Schemas extends z.ZodTypeAny[]>(
  channel: string,
  schemas: [...Schemas],
  fn: (...args: Infer<Schemas>) => unknown,
): void {
  ipcMain.handle(channel, (_event, ...raw: unknown[]) => fn(...parseArgs(schemas, raw)))
}
