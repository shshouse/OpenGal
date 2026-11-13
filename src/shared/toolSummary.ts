/**
 * 工具轨迹摘要：只给人看，不参与模型上下文。
 *
 * web_search/read_web_page 的结果前面有一大段安全包装，直接截前 240 字只会显示包装语；
 * 这里把真正的 query、标题和页面地址提出来。
 */
import { SCREEN_FALLBACK_MARKER } from './screen'

const MAX_FALLBACK = 240

function firstMatch(source: string, pattern: RegExp): string {
  return source.match(pattern)?.[1]?.trim() ?? ''
}

export function summarizeToolResult(name: string, result: string): string {
  if (name === 'web_search') {
    const query = firstMatch(result, /source="web_search:\s*([^"]*)"/)
    const titles = [...result.matchAll(/^标题:\s*(.+)$/gm)]
      .map((m) => m[1]?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 3)
    if (query) {
      const lines = [`查询：${query}`]
      if (titles.length > 0) lines.push(...titles.map((title, index) => `${index + 1}. ${title}`))
      else lines.push('无结果')
      return lines.join('\n')
    }
  }

  if (name === 'read_web_page') {
    const url = firstMatch(result, /source="web_page:\s*([^"]*)"/)
    const end = result.indexOf('</web-content>')
    const body = (end > 0 ? result.slice(0, end) : result)
      .replace(/^\[[^\]]*\]\s*/s, '')
      .replace(/<web-content[^>]*>/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    return [`页面：${url || '（未知）'}`, body.slice(0, 160)].filter(Boolean).join('\n')
  }

  if (name === 'screenshot') return '已拍摄屏幕截图'
  if (name === 'look_screen') {
    return result.startsWith(SCREEN_FALLBACK_MARKER) ? '只看到此刻一帧' : '已获取屏幕画面'
  }

  return result.replace(/\s+/g, ' ').trim().slice(0, MAX_FALLBACK)
}
