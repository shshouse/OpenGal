/** 1.2w / 3.4k 这类紧凑计数，卡片和详情页共用。 */
export function formatNumber(num: number): string {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return num.toString()
}

/** 字节数转可读大小；未知或非正数统一显示「未知大小」。 */
export function formatFileSize(size?: number | null): string {
  if (!size || size <= 0) return '未知大小'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(fractionDigits)}${units[unitIndex]}`
}
