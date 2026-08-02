/**
 * 极简 RAG：扫描 data/ 下所有 .txt，按段落切片，用关键词重合度评分。
 *
 * 为什么不用向量嵌入：
 * - 当前知识库规模小（一个项目几百行说明）
 * - 关键词方案零依赖、即时启动、可解释
 * - 中英文都吃，不依赖分词器
 *
 * 切片策略：以换行+空行（段落边界）切分，长段落二次按 200 字窗口切片，
 * 避免单条 chunk 过长稀释相关性。
 *
 * 全文回退：当 query 明确提到某个 .txt 文件名（如"test.txt 的第五行"），
 * 关键词检索天然失效（query 与 chunk 无 token 重合），自动切换为按行
 * 加载该文件全文，每行一个 chunk，注入 system 让 LLM 直接按行号引用。
 */

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logBus } from '../logBus'

export interface RagChunk {
  source: string  // 相对 data/ 的文件名；全文模式追加 `:${行号}`
  text: string    // 切片内容
}

const MAX_CHUNK_CHARS = 200
// 匹配 query 中的文件名引用，如 "test.txt"、"data/foo.txt" 末段
const FILENAME_PATTERN = /([\w\-一-鿿]+(?:\.[\w\-一-鿿]+)*\.txt)\b/gi

interface RagSearchResult {
  chunks: RagChunk[]
  /** 是否走"全文回退"模式（文件名探测命中） */
  fullFile: boolean
}

let cached: {
  chunks: RagChunk[]
  files: string[]   // data/ 下的所有 .txt 文件名（去重）
  loadedAt: number
} | null = null

function getDataDir(): string {
  // dev: app.getAppPath() 即项目根；packaged: 通过 extraResources 注入
  return process.env.OPENGAL_DATA_DIR
    || (app.isPackaged
      ? path.join(process.resourcesPath, 'data')
      : path.join(app.getAppPath(), 'data'))
}

function splitIntoChunks(text: string, source: string): RagChunk[] {
  const chunks: RagChunk[] = []
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  for (const para of paragraphs) {
    if (para.length <= MAX_CHUNK_CHARS) {
      chunks.push({ source, text: para })
    } else {
      // 滑动窗口：按句号/换行优先切
      const windows = para.match(new RegExp(`[\\s\\S]{1,${MAX_CHUNK_CHARS}}`, 'g')) ?? []
      for (const w of windows) chunks.push({ source, text: w.trim() })
    }
  }
  return chunks
}

/** 全文模式：把文件按行切片，每行一个 chunk，source 携带行号 */
function splitByLine(text: string, source: string): RagChunk[] {
  return text
    .split('\n')
    .map((line, idx) => ({ source: `${source}:${idx + 1}`, text: line }))
    .filter((c) => c.text.trim().length > 0)
}

/** 从 query 中探测提到的 .txt 文件名（与已有文件列表求交集） */
function detectFileQuery(query: string, available: string[]): string[] {
  const hits = new Set<string>()
  for (const m of query.matchAll(FILENAME_PATTERN)) {
    const name = m[1].toLowerCase()
    // 接受完整文件名或 basename
    const matched = available.find((f) => f.toLowerCase() === name)
    if (matched) hits.add(matched)
  }
  return Array.from(hits)
}

function tokenize(text: string): string[] {
  // 同时支持中英文：中文逐字、英文/数字按词
  return text
    .toLowerCase()
    .replace(/[\p{P}]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/**
 * 加载 data/ 下所有 .txt，切片并缓存。
 * 重复调用直接返回缓存；缓存命中后通过 reloadRag() 强制重建。
 */
export function loadRag(): RagChunk[] {
  if (cached) return cached.chunks

  const dir = getDataDir()
  if (!fs.existsSync(dir)) {
    logBus.warn('rag', `data 目录不存在: ${dir}`)
    cached = { chunks: [], files: [], loadedAt: Date.now() }
    return cached.chunks
  }

  const chunks: RagChunk[] = []
  const files: string[] = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.txt')) continue
    const filePath = path.join(dir, name)
    if (!fs.statSync(filePath).isFile()) continue
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      files.push(name)
      chunks.push(...splitIntoChunks(content, name))
    } catch (err) {
      logBus.error('rag', `读取失败: ${filePath}`, (err as Error).message)
    }
  }
  cached = { chunks, files, loadedAt: Date.now() }
  logBus.info('rag', `已加载 ${chunks.length} 条知识片段 / ${files.length} 个文件 from ${dir}`)
  return chunks
}

/** 取已加载的文件列表（去重） */
export function getRagFiles(): string[] {
  if (!cached) loadRag()
  return cached?.files ?? []
}

/** 读取指定文件的全文内容 */
export function readRagFile(fileName: string): string | null {
  const dir = getDataDir()
  const filePath = path.join(dir, fileName)
  if (!fs.existsSync(filePath)) return null
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

export function reloadRag(): RagChunk[] {
  cached = null
  return loadRag()
}

/**
 * 检索 top-k 片段。先尝试"全文回退"（query 提到文件名），再走关键词 top-k。
 *
 * 全文回退：把提到的文件按行加载，每行一个 chunk，全部返回（不截断）。
 * 关键词模式：query tokens 与 chunk tokens 交集大小排序。
 * 故意不归一化：短 chunk 自带"专注"奖励，长 chunk 需要更多命中才上榜。
 */
export function searchRag(query: string, topK = 3): RagSearchResult {
  loadRag()  // 确保缓存被填充
  const files = cached?.files ?? []
  if (!query.trim() || files.length === 0) {
    return { chunks: [], fullFile: false }
  }

  // 1) 全文回退：query 提到文件名时，按行加载该文件
  const mentioned = detectFileQuery(query, files)
  if (mentioned.length > 0) {
    const dir = getDataDir()
    const chunks: RagChunk[] = []
    for (const name of mentioned) {
      try {
        const content = fs.readFileSync(path.join(dir, name), 'utf-8')
        chunks.push(...splitByLine(content, name))
      } catch (err) {
        logBus.error('rag', `全文加载失败: ${name}`, (err as Error).message)
      }
    }
    logBus.info('rag', `全文回退: ${mentioned.join(', ')} (${chunks.length} 行)`)
    return { chunks, fullFile: true }
  }

  // 2) 关键词 top-k
  const chunks = loadRag()
  if (chunks.length === 0) return { chunks: [], fullFile: false }

  const queryTokens = new Set(tokenize(query))
  if (queryTokens.size === 0) return { chunks: [], fullFile: false }

  const scored = chunks.map((chunk) => {
    const chunkTokens = new Set(tokenize(chunk.text))
    let hits = 0
    for (const qt of queryTokens) if (chunkTokens.has(qt)) hits++
    return { chunk, score: hits }
  })
  scored.sort((a, b) => b.score - a.score)
  return {
    chunks: scored.filter((s) => s.score > 0).slice(0, topK).map((s) => s.chunk),
    fullFile: false,
  }
}

/**
 * 把检索结果格式化为可塞进 system prompt 的字符串。
 * 全文模式强调"这是用户电脑上的本地文件"避免 LLM 拒答。
 */
export function formatRagContext(query: string, topK = 3): string {
  const result = searchRag(query, topK)
  if (result.chunks.length === 0) return ''
  const blocks = result.chunks.map((h, i) => `[${i + 1}] (${h.source})\n${h.text}`).join('\n\n')
  if (result.fullFile) {
    return `以下是用户电脑本地 data/ 目录中文件的内容（可被直接读取和引用，含行号）：\n${blocks}\n\n` +
      `回答时可以直接引用其中的行号 / 内容；如果用户问的是行号 / 位置，请精确到那一行。`
  }
  return `以下是与用户问题相关的知识库片段，来源于用户电脑本地文件：\n${blocks}\n\n` +
    `回答时请优先基于以上片段；如果问题超出片段内容，请明确说明。`
}
