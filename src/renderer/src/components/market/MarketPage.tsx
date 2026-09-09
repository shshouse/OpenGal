import * as React from 'react'
import { Download, RefreshCw, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { MarketListResult, MarketMod, MarketDownloadProgress } from '@shared/types'

const SORTS = [
  { value: 'latest', label: '最新发布' },
  { value: 'updated', label: '最近更新' },
  { value: 'downloads', label: '下载最多' },
  { value: 'rating', label: '好评最多' },
]

function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`
}

export function MarketPage() {
  const [data, setData] = React.useState<MarketListResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [sort, setSort] = React.useState('latest')
  const [category, setCategory] = React.useState<string | undefined>(undefined)
  const [progress, setProgress] = React.useState<Record<string, MarketDownloadProgress>>({})

  React.useEffect(() => {
    const off = window.opengal.market.onDownloadProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.modId]: p }))
    })
    return () => {
      off()
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.opengal.market
      .list({ page, sort, category })
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) {
          setData(res.data)
        } else {
          setError(res.error || '加载失败')
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, sort, category])

  async function handleDownload(mod: MarketMod): Promise<void> {
    setProgress((prev) => ({
      ...prev,
      [mod.id]: { modId: mod.id, title: mod.title, received: 0, total: 0, done: false },
    }))
    const res = await window.opengal.market.download(mod.id, mod.versions?.[0]?.id)
    if (!res.success) {
      setProgress((prev) => ({
        ...prev,
        [mod.id]: {
          modId: mod.id,
          title: mod.title,
          received: 0,
          total: 0,
          done: true,
          error: res.error || '下载失败',
        },
      }))
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.totalMods / (data.pageSize || 20))) : 1

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        <span className="text-sm font-semibold">模组市场</span>
        <span className="ml-3 text-xs text-muted-foreground">
          {data ? `${data.game.name} · ${formatCount(data.totalMods)} 个模组` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                sort === s.value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60'
              )}
              onClick={() => {
                setSort(s.value)
                setPage(1)
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {data && data.categories.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-4 py-2">
          <button
            type="button"
            className={cn(
              'rounded-full px-2.5 py-1 text-xs transition-colors',
              !category ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
            )}
            onClick={() => {
              setCategory(undefined)
              setPage(1)
            }}
          >
            全部
          </button>
          {data.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                category === c.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
              )}
              onClick={() => {
                setCategory(c.id)
                setPage(1)
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <RefreshCw className="mr-2 size-4 animate-spin" /> 加载中...
          </div>
        )}
        {!loading && error && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <XCircle className="size-5 text-destructive" />
            {error}
            <Button size="sm" variant="outline" onClick={() => setPage((p) => p)}>
              重试
            </Button>
          </div>
        )}
        {!loading && !error && data && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.mods.map((mod) => {
                const cover = mod.cover_url || mod.images?.[0] || null
                const p = progress[mod.id]
                const downloading = p && !p.done
                const ok = p?.done && !p.error
                const failed = p?.done && p.error
                const sizeLabel = formatSize(mod.versions?.[0]?.file_size)
                return (
                  <div key={mod.id} className="flex flex-col overflow-hidden rounded-lg border bg-card">
                    <div className="relative h-32 bg-muted">
                      {cover ? (
                        <img src={cover} alt={mod.title} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <Package className="size-8 text-muted-foreground/40" />
                        </div>
                      )}
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-1 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium">{mod.title}</span>
                        {mod.category && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {mod.category.name}
                          </span>
                        )}
                      </div>
                      {mod.description && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">{mod.description}</p>
                      )}
                      <div className="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground">
                        <span>
                          {mod.author?.username ? `${mod.author.username} · ` : ''}
                          ⬇ {formatCount(mod.download_count)}
                          {sizeLabel ? ` · ${sizeLabel}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 flex-1 gap-1 text-xs"
                          disabled={downloading || ok}
                          onClick={() => void handleDownload(mod)}
                        >
                          {ok ? (
                            <>
                              <CheckCircle2 className="size-3.5 text-emerald-500" /> 已下载
                            </>
                          ) : failed ? (
                            <>
                              <XCircle className="size-3.5 text-destructive" /> 重试
                            </>
                          ) : (
                            <>
                              <Download className="size-3.5" /> 下载
                            </>
                          )}
                        </Button>
                      </div>
                      {downloading && (
                        <div className="space-y-1 pt-1">
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{
                                width: p.total > 0 ? `${Math.round((p.received / p.total) * 100)}%` : '30%',
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {p.total > 0
                              ? `${(p.received / 1024 / 1024).toFixed(1)} / ${(p.total / 1024 / 1024).toFixed(1)}MB`
                              : `${(p.received / 1024 / 1024).toFixed(1)}MB`}
                          </span>
                        </div>
                      )}
                      {failed && <span className="text-[10px] text-destructive">{p.error}</span>}
                      {ok && <span className="text-[10px] text-muted-foreground">已下载</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            {data.mods.length === 0 && (
              <div className="py-16 text-center text-sm text-muted-foreground">该分类下暂无模组</div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
