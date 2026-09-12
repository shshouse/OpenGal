import { desktopCapturer, app } from 'electron'
import path from 'node:path'
import fg from 'fast-glob'
import pRetry from 'p-retry'
import type { ToolDefinition } from '@shared/types'
import { registerTool } from './index'
import { sanitizeWebText, wrapWebContent, MAX_SNIPPET_CHARS } from './webFirewall'
import { readConfig } from '../configStore'
import { logBus } from '../logBus'

export const SCREENSHOT_MARKER = 'OPENGAL_SCREENSHOT:'

type ToolHandler = (args: Record<string, unknown>) => Promise<string>

const SCREENSHOT_COOLDOWN_MS = 10_000
let lastShotAt = 0

async function handleScreenshot(): Promise<string> {
  if (Date.now() - lastShotAt < SCREENSHOT_COOLDOWN_MS) {
    throw new Error('截图过于频繁（限 10 秒一次）')
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 1280 },
  })
  const primary = sources.find((s) => s.display_id !== '') ?? sources[0]
  if (!primary) throw new Error('无可用屏幕')
  lastShotAt = Date.now()
  return `${SCREENSHOT_MARKER}data:image/png;base64,${primary.thumbnail.toPNG().toString('base64')}`
}

function fileSearchRoots(): string[] {
  const cfg = readConfig().tools
  const extra = Array.isArray(cfg.fileSearchDirs) ? cfg.fileSearchDirs : []
  const defaults = [
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('desktop'),
  ]
  return [...new Set([...defaults, ...extra].filter((d) => d))]
}

async function handleLocalFileSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) throw new Error('query 不能为空')
  const maxResults = Math.min(50, Math.max(1, Number(args.maxResults) || 20))
  const hasGlob = /[*?]/.test(query)
  const pattern = hasGlob ? query : `**/*${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}*`
  const results: string[] = []
  for (const root of fileSearchRoots()) {
    if (results.length >= maxResults) break
    const found = await fg(pattern, {
      cwd: root,
      deep: 6,
      onlyFiles: true,
      caseSensitiveMatch: false,
      suppressErrors: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/$RECYCLE.BIN/**'],
    })
    for (const f of found) {
      if (results.length >= maxResults) break
      results.push(path.join(root, f))
    }
  }
  if (results.length === 0) return `未找到匹配「${sanitizeWebText(query, 100)}」的文件`
  return `找到 ${results.length} 个文件：\n${results.join('\n')}`
}

interface BingResult {
  title: string
  url: string
  snippet: string
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]{0,300}>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function parseBingResults(html: string): BingResult[] {
  const results: BingResult[] = []
  const liRe = /<li class="b_algo"[\s\S]*?<\/li>/g
  for (const li of html.match(liRe) ?? []) {
    const aMatch = li.match(/<h2>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!aMatch) continue
    const pMatch = li.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    results.push({
      url: aMatch[1],
      title: stripTags(aMatch[2]),
      snippet: pMatch ? stripTags(pMatch[1]).slice(0, MAX_SNIPPET_CHARS) : '',
    })
  }
  return results
}

async function bingSearch(query: string): Promise<BingResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-hans&mkt=zh-CN`
  const res = await pRetry(
    () =>
      fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(15_000),
      }),
    { retries: 2 },
  )
  if (!res.ok) throw new Error(`必应搜索 HTTP ${res.status}`)
  return parseBingResults(await res.text())
}

async function tavilySearch(query: string, key: string): Promise<BingResult[]> {
  const res = await pRetry(
    () =>
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, query, max_results: 8 }),
        signal: AbortSignal.timeout(20_000),
      }),
    { retries: 1 },
  )
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`)
  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> }
  return (data.results ?? []).map((r) => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: String(r.content ?? '').slice(0, MAX_SNIPPET_CHARS),
  }))
}

async function handleWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) throw new Error('query 不能为空')
  const cfg = readConfig().tools.webSearch
  let results: BingResult[]
  if (cfg.provider === 'tavily' && cfg.tavilyKey) {
    results = await tavilySearch(query, cfg.tavilyKey)
  } else {
    results = await bingSearch(query)
  }
  if (results.length === 0) return `搜索「${sanitizeWebText(query, 100)}」无结果`
  return wrapWebContent(
    `web_search: ${query}`,
    results.map((r) => ({ text: `标题: ${r.title}\n链接: ${r.url}\n摘要: ${r.snippet}` })),
  )
}

async function handleReadWebPage(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url ?? '').trim()
  if (!/^https:\/\//i.test(url)) throw new Error('仅支持 https:// 链接')
  const res = await pRetry(
    () => fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(30_000) }),
    { retries: 1 },
  )
  if (!res.ok) throw new Error(`网页读取 HTTP ${res.status}`)
  const text = await res.text()
  return wrapWebContent(`web_page: ${url}`, [{ text }])
}

export function registerBuiltinTools(): void {
  const defs: Array<{ def: ToolDefinition; handle: ToolHandler }> = [
    {
      def: {
        type: 'function',
        function: {
          name: 'screenshot',
          description:
            '拍摄用户屏幕截图并返回图片，让你看到用户当前屏幕内容。限 10 秒一次。适合用户提到"屏幕上/这个画面"时使用。',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      handle: () => handleScreenshot(),
    },
    {
      def: {
        type: 'function',
        function: {
          name: 'local_file_search',
          description:
            '按文件名在用户的文档/下载/桌面目录搜索文件（只读，不读取文件内容）。query 支持文件名关键词或 glob 通配符（* ?）。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '文件名关键词或 glob 模式' },
              maxResults: { type: 'number', description: '最多返回条数，默认 20' },
            },
            required: ['query'],
          },
        },
      },
      handle: (args) => handleLocalFileSearch(args),
    },
    {
      def: {
        type: 'function',
        function: {
          name: 'web_search',
          description: '联网搜索。返回带标题、链接、摘要的结果列表。用户问时效性问题或你不确定的事实时使用。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词' },
            },
            required: ['query'],
          },
        },
      },
      handle: (args) => handleWebSearch(args),
    },
    {
      def: {
        type: 'function',
        function: {
          name: 'read_web_page',
          description: '读取一个网页的正文内容（转成纯文本）。配合 web_search 的链接使用，逐次读取。',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'https:// 开头的网页链接' },
            },
            required: ['url'],
          },
        },
      },
      handle: (args) => handleReadWebPage(args),
    },
  ]
  for (const { def, handle } of defs) {
    registerTool(def, handle)
  }
  logBus.info('tools', `内置工具已注册: ${defs.map((d) => d.def.function.name).join(', ')}`)
}
