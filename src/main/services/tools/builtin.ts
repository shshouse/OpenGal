import { desktopCapturer, app } from 'electron'
import path from 'node:path'
import fg from 'fast-glob'
import type { ToolDefinition } from '@shared/types'
import { registerTool } from './registry'
import { optionalString, requireString } from './args'
import { sanitizeWebText, wrapWebContent, MAX_SNIPPET_CHARS } from './webFirewall'
import { readConfig } from '../configStore'
import { getMemoryBlock, recallVerbatim } from '../memoryStore'
import { logBus } from '../logBus'

type RetryFn = <T>(task: () => Promise<T>, opts?: { retries?: number }) => Promise<T>
async function withRetry<T>(task: () => Promise<T>, retries = 2): Promise<T> {
  const mod = (await import('p-retry')) as unknown as { default?: RetryFn } & RetryFn
  const pRetry = (mod.default ?? mod) as RetryFn
  return pRetry(task, { retries })
}

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
  const query = requireString(args, 'query')
  const rawMax = args.maxResults
  const maxResults =
    typeof rawMax === 'number' && Number.isFinite(rawMax)
      ? Math.min(50, Math.max(1, Math.trunc(rawMax)))
      : 20
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
    .replace(/&ensp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      try {
        return String.fromCodePoint(Number(n))
      } catch {
        return ''
      }
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function parseBingResults(html: string): BingResult[] {
  const results: BingResult[] = []
  const seen = new Set<string>()
  const h2Re = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = h2Re.exec(html)) !== null) {
    const url = m[1]
    const title = stripTags(m[2] ?? '')
    if (!url || !title || seen.has(url)) continue
    seen.add(url)
    const rest = html.slice(m.index + m[0].length, m.index + m[0].length + 3000)
    const pMatch = rest.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    results.push({
      url,
      title,
      snippet: pMatch ? stripTags(pMatch[1] ?? '').slice(0, MAX_SNIPPET_CHARS) : '',
    })
  }
  return results.slice(0, 10)
}

async function bingSearch(query: string): Promise<BingResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-hans&mkt=zh-CN`
  const res = await withRetry(
    () =>
      fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(15_000),
      }),
    2,
  )
  if (!res.ok) throw new Error(`必应搜索 HTTP ${res.status}`)
  return parseBingResults(await res.text())
}

async function tavilySearch(query: string, key: string): Promise<BingResult[]> {
  const res = await withRetry(
    () =>
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, query, max_results: 8 }),
        signal: AbortSignal.timeout(20_000),
      }),
    1,
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
  const query = requireString(args, 'query')
  const cfg = readConfig().tools.webSearch
  let results: BingResult[]
  if (cfg.provider === 'tavily' && cfg.tavilyKey) {
    results = await tavilySearch(query, cfg.tavilyKey)
  } else {
    results = await bingSearch(query)
  }
  if (results.length === 0) {
    return '搜索无结果：必应返回了页面但未解析出常规结果（可能被风控或页面结构变化）。可稍后重试，或在设置→环境中切换 Tavily 搜索源。'
  }
  return wrapWebContent(
    `web_search: ${query}`,
    results.map((r) => ({ text: `标题: ${r.title}\n链接: ${r.url}\n摘要: ${r.snippet}` })),
  )
}

async function handleReadWebPage(args: Record<string, unknown>): Promise<string> {
  const url = requireString(args, 'url')
  if (!/^https:\/\//i.test(url)) throw new Error('仅支持 https:// 链接')
  const res = await withRetry(
    () => fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(30_000) }),
    1,
  )
  if (!res.ok) throw new Error(`网页读取 HTTP ${res.status}`)
  const text = await res.text()
  return wrapWebContent(`web_page: ${url}`, [{ text }])
}

const RECALL_CHAR_CAP = 1200

async function handleRecallMemory(args: Record<string, unknown>): Promise<string> {
  const query = requireString(args, 'query')
  const characterId = readConfig().activeCharacterId
  if (!characterId) throw new Error('当前没有激活角色')
  const fromRaw = optionalString(args, 'from')
  const toRaw = optionalString(args, 'to')
  const fromTs = fromRaw ? Date.parse(fromRaw) : NaN
  const toTs = toRaw ? Date.parse(toRaw) : NaN
  const range = Number.isFinite(fromTs) && Number.isFinite(toTs) ? { fromTs, toTs } : undefined
  const [block, verbatim] = await Promise.all([
    getMemoryBlock(characterId, query, true, RECALL_CHAR_CAP),
    recallVerbatim(characterId, query, 1500, range),
  ])
  const parts = [block, verbatim].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join('\n\n') : '没有找到相关的长期记忆'
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
    {
      def: {
        type: 'function',
        function: {
          name: 'recall_memory',
          description:
            '检索长期记忆（过去的事实、约定、偏好、共同经历）和相关历史原话。用户提到"以前/上次/你还记得"、或问某句话具体怎么说的时使用。返回记忆片段，以及带时间戳和相邻对话的原话；用户限定时间段时用 from/to 传入日期。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '要回忆的主题或关键词' },
              from: { type: 'string', description: '可选，起始日期（YYYY-MM-DD），用于只回溯某段时间' },
              to: { type: 'string', description: '可选，结束日期（YYYY-MM-DD）' },
            },
            required: ['query'],
          },
        },
      },
      handle: (args) => handleRecallMemory(args),
    },
  ]
  for (const { def, handle } of defs) {
    registerTool(def, handle)
  }
  logBus.info('tools', `内置工具已注册: ${defs.map((d) => d.def.function.name).join(', ')}`)
}
