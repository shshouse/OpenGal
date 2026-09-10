import * as React from 'react'
import { RefreshCw, ChevronLeft, ChevronRight, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { ModCard } from './ModCard'
import { ModDetail } from './ModDetail'
import type { MarketListResult, MarketMod } from '@shared/types'

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

export function MarketPage() {
  const [data, setData] = React.useState<MarketListResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [page, setPage] = React.useState(1)
  const [sort, setSort] = React.useState('latest')
  const [category, setCategory] = React.useState<string | undefined>(undefined)
  const [selected, setSelected] = React.useState<MarketMod | null>(null)

  async function handleGet(mod: MarketMod, versionId?: string): Promise<void> {
    const version = versionId
      ? mod.versions?.find((v) => v.id === versionId)
      : (mod.versions?.find((v) => v.id === mod.latest_version_id) ??
        mod.versions?.find((v) => v.status === 'active'))
    await window.opengal.market.open(mod.mod_number, version?.id)
  }

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

  const totalPages = data ? Math.max(1, Math.ceil(data.totalMods / (data.pageSize || 20))) : 1

  if (selected) {
    return (
      <ModDetail
        key={selected.id}
        mod={selected}
        onGet={(m, v) => void handleGet(m, v)}
        onBack={() => setSelected(null)}
      />
    )
  }

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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
              {data.mods.map((mod) => (
                <ModCard key={mod.id} mod={mod} onGet={(m) => void handleGet(m)} onOpen={setSelected} />
              ))}
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
