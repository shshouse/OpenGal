/**
 * 角色卡 voice 配置来自 JSON，字段类型不可信。
 * 非字符串一律按「未配置」处理，避免 String({}) 得到 "[object Object]" 后被当作路径或 URL 使用。
 */
export function pickString(source: Record<string, unknown>, key: string): string {
  const raw = source[key]
  return typeof raw === 'string' ? raw : ''
}
