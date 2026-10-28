const ELLIPSIS = '…'
const MAX_EXT_CHARS = 12

/**
 * 长文件名中间省略，后缀完整保留。
 * 按字符数（码点）截断，不做宽度测量，避免布局阶段读取尺寸。
 */
export function middleEllipsis(name: string, max = 24): string {
  const trimmed = name.trim()
  const chars = Array.from(trimmed)
  if (chars.length <= max) return trimmed

  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const dot = trimmed.lastIndexOf('.')
  const ext =
    dot > separator + 1 && trimmed.length - dot <= MAX_EXT_CHARS ? trimmed.slice(dot) : ''
  const extChars = Array.from(ext)
  const baseChars = chars.slice(0, chars.length - extChars.length)

  // 留给省略号两侧的预算：忽略后缀与省略号本身
  const budget = max - extChars.length - 1
  if (budget < 3) return trimmed

  const head = Math.ceil(budget * 0.55)
  const tail = budget - head
  return (
    baseChars.slice(0, head).join('') +
    ELLIPSIS +
    baseChars.slice(baseChars.length - tail).join('') +
    ext
  )
}
