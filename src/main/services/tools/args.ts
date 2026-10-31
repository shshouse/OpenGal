/**
 * 工具参数由 LLM 填充，属于不可信输入。
 * 类型不符必须显式报错，不能 String() 成 "[object Object]" 后继续执行。
 */

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const raw = args[key]
  if (raw === undefined || raw === null) throw new Error(`缺少参数 ${key}`)
  if (typeof raw !== 'string') {
    throw new Error(`参数 ${key} 必须是字符串，实际收到 ${describeType(raw)}`)
  }
  const value = raw.trim()
  if (!value) throw new Error(`参数 ${key} 不能为空`)
  return value
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const raw = args[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') {
    throw new Error(`参数 ${key} 必须是字符串，实际收到 ${describeType(raw)}`)
  }
  const value = raw.trim()
  return value || undefined
}
