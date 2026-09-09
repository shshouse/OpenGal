import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type { MarketListResult } from '@shared/types'
import { getModRoot } from './paths'
import { logBus } from './logBus'

const API_BASE = 'https://mikumod.com'
const GAME_NUMBER = '8'

interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as ApiResult<T>
  if (!body.success || body.data === undefined) throw new Error(body.error || '接口返回异常')
  return body.data
}

export async function fetchMarketMods(options: {
  page?: number
  sort?: string
  category?: string
}): Promise<MarketListResult> {
  const page = options.page ?? 1
  const sort = options.sort ?? 'latest'
  const params = new URLSearchParams({ page: String(page), sort })
  if (options.category) params.set('category', options.category)
  return apiGet<MarketListResult>(`${API_BASE}/api/games/${GAME_NUMBER}/mods?${params}`)
}

export interface DownloadProgress {
  modId: string
  title: string
  received: number
  total: number
  done: boolean
  error?: string
  filePath?: string
}
export async function downloadMarketMod(
  sender: BrowserWindow['webContents'],
  modId: string,
  versionId?: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/mods/${modId}/download${versionId ? `?version_id=${versionId}` : ''}`, {
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`获取下载链接失败: HTTP ${res.status}`)
  const body = (await res.json()) as ApiResult<{
    url: string
    fileName: string | null
    fileSize: number | null
    version: string
  }>
  if (!body.success || !body.data) throw new Error(body.error || '获取下载链接失败')

  const { url, fileName, fileSize } = body.data
  const fileRes = await fetch(url, { signal: AbortSignal.timeout(600000) })
  if (!fileRes.ok || !fileRes.body) throw new Error(`下载失败: HTTP ${fileRes.status}`)

  const total = fileSize ?? Number(fileRes.headers.get('content-length') ?? 0)
  const dir = path.join(getModRoot(), 'Market')
  fs.mkdirSync(dir, { recursive: true })
  const safeName = (fileName || `${modId}.zip`).replace(/[\\/:*?"<>|]/g, '_')
  const target = path.join(dir, safeName)
  const tmp = `${target}.tmp`

  const reader = fileRes.body.getReader()
  const chunks: Buffer[] = []
  let received = 0
  let lastPct = -1
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
    received += value.byteLength
    const pct = total > 0 ? Math.floor((received / total) * 100) : -1
    if (pct !== lastPct) {
      lastPct = pct
      sender.send('market:downloadProgress', { modId, title: safeName, received, total, done: false })
    }
  }
  fs.writeFileSync(tmp, Buffer.concat(chunks))
  fs.renameSync(tmp, target)
  logBus.info('market', `模组已下载: ${safeName} (${(received / 1024 / 1024).toFixed(1)}MB) -> ${dir}`)
  sender.send('market:downloadProgress', { modId, title: safeName, received, total, done: true, filePath: target })
}
