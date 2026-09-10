import { app, shell } from 'electron'
import type { MarketListResult } from '@shared/types'
import { logBus } from './logBus'

const API_BASE = 'https://mikumod.com'
const GAME_NUMBER = '8'

interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

async function apiGet<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } }
    logBus.warn('market', `MikuMod请求失败: ${e.message} code=${e.cause?.code ?? '-'}`)
    if (e.name === 'TimeoutError') throw new Error('连接超时，请检查网络')
    throw new Error('网络连接失败，请检查网络')
  }
  if (!res.ok) throw new Error(`服务器返回 HTTP ${res.status}`)
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


export async function openMarketMod(
  modNumber: number,
  versionId?: string,
): Promise<'desktop' | 'web'> {
  const handler = app.getApplicationNameForProtocol('mikumod://x')
  const query = versionId ? `?version=${versionId}` : ''
  const target = handler
    ? `mikumod://mods/${modNumber}${query}`
    : `${API_BASE}/mods/${modNumber}`
  logBus.info('market', handler ? `交给 MikuMod Desktop: mod/${modNumber}` : `浏览器打开: mods/${modNumber}`)
  await shell.openExternal(target)
  return handler ? 'desktop' : 'web'
}
