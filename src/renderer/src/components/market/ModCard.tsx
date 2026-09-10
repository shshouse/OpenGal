import { useState } from 'react'
import { Download, Eye, ThumbsUp, User, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MarketMod } from '@shared/types'

interface ModCardProps {
  mod: MarketMod
  onGet: (mod: MarketMod) => void
  onOpen: (mod: MarketMod) => void
}

function formatNumber(num: number): string {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
  return num.toString()
}

function formatFileSize(size?: number | null): string {
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

export function ModCard({ mod, onGet, onOpen }: ModCardProps) {
  const [imageError, setImageError] = useState(false)

  const latestVersion =
    mod.versions?.find((v) => v.id === mod.latest_version_id) ??
    mod.versions?.find((v) => v.version === mod.latest_version && v.status === 'active') ??
    mod.versions?.find((v) => v.status === 'active')
  const fileSizeLabel = formatFileSize(latestVersion?.file_size)

  return (
    <article
      className="flex h-full cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors duration-200 hover:border-foreground/30"
      onClick={() => onOpen(mod)}
    >
      {/* 封面图 */}
      <div className="relative h-44 overflow-hidden bg-muted">
        {mod.media?.thumbnail_url && !imageError ? (
          <img
            src={mod.media.thumbnail_url}
            alt={mod.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Package className="size-7" />
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 flex-col p-2.5">
        <h3 className="line-clamp-1 text-sm font-semibold text-foreground">{mod.title}</h3>

        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <Eye className="size-3" />
            {formatNumber(mod.view_count ?? 0)}
          </span>
          <span className="flex items-center gap-0.5">
            <Download className="size-3" />
            {formatNumber(mod.download_count ?? 0)}
          </span>
          {(mod.like_count ?? 0) > 0 && (
            <span className="flex items-center gap-0.5">
              <ThumbsUp className="size-3" />
              {formatNumber(mod.like_count)}
            </span>
          )}
          <span className="ml-auto shrink-0 font-medium text-foreground/80">{fileSizeLabel}</span>
        </div>

        <div className="mt-1.5 flex min-h-4 items-center gap-1.5">
          {mod.author?.avatar_url ? (
            <img src={mod.author.avatar_url} alt={mod.author.username || 'Author'} className="size-4 rounded-full" />
          ) : (
            <User className="size-3.5 text-muted-foreground" />
          )}
          {mod.source_info?.source_type === 'repost' && (
            <span className="text-[11px] text-muted-foreground/60">上传者</span>
          )}
          <span className="truncate text-xs text-muted-foreground">{mod.author?.username || '匿名'}</span>
          {mod.source_info?.source_type === 'original' && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-emerald-500">原创</span>
          )}
          {mod.source_info?.source_type === 'repost' && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-amber-500">转载</span>
          )}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-2">
          <span className="max-w-[7rem] truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {mod.category?.name || '未分类'}
          </span>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <Button
            type="button"
            size="sm"
            className="h-7 flex-1 gap-1 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              onGet(mod)
            }}
          >
            <Download className="size-3.5" /> 获取
          </Button>
        </div>
      </div>
    </article>
  )
}
