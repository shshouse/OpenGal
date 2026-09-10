import { useState } from 'react'
import { ChevronLeft, CircleCheck, Download, Eye, FileText, Layers, ThumbsUp, User, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MarketMod } from '@shared/types'

interface ModDetailProps {
  mod: MarketMod
  onGet: (mod: MarketMod, versionId?: string) => void
  onBack: () => void
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

export function ModDetail({ mod, onGet, onBack }: ModDetailProps) {
  const [tab, setTab] = useState<'desc' | 'versions'>('desc')
  const images =
    mod.media?.image_urls?.length
      ? mod.media.image_urls
      : mod.media?.thumbnail_url
        ? [mod.media.thumbnail_url]
        : []
  const [active, setActive] = useState(0)
  const [mainError, setMainError] = useState(false)

  const versions = mod.versions ?? []
  const latestVersion =
    versions.find((v) => v.id === mod.latest_version_id) ??
    versions.find((v) => v.version === mod.latest_version && v.status === 'active') ??
    versions.find((v) => v.status === 'active')

  const publishDate = latestVersion?.created_at
    ? new Date(latestVersion.created_at).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  const stats = [
    { icon: Download, value: formatNumber(mod.download_count ?? 0), label: '下载' },
    { icon: Eye, value: formatNumber(mod.view_count ?? 0), label: '浏览' },
    { icon: ThumbsUp, value: formatNumber(mod.like_count ?? 0), label: '点赞' },
  ]

  return (
    <div className="flex h-full w-full gap-4 overflow-auto bg-background p-4">
      {/* 左主列 */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Button variant="ghost" size="sm" className="self-start gap-1" onClick={onBack}>
          <ChevronLeft className="size-4" />
          返回
        </Button>

        <div className="flex items-center justify-center overflow-hidden rounded-xl border bg-muted">
          {images[active] && !mainError ? (
            <img
              src={images[active]}
              alt={mod.title}
              className="max-h-[520px] w-full object-contain"
              onError={() => setMainError(true)}
            />
          ) : (
            <div className="flex h-72 items-center justify-center">
              <Package className="size-10 text-muted-foreground/40" />
            </div>
          )}
        </div>
        {images.length > 1 && (
          <div className="flex gap-2 overflow-auto pb-1">
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => {
                  setActive(i)
                  setMainError(false)
                }}
                className={cn(
                  'h-14 w-20 shrink-0 overflow-hidden rounded border bg-muted',
                  i === active && 'ring-1 ring-primary'
                )}
              >
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* Tab 页 */}
        <div className="flex items-center gap-6 border-b">
          {([
            { key: 'desc', icon: FileText, label: '描述' },
            { key: 'versions', icon: Layers, label: `版本（${versions.length}）` },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 pb-2.5 text-sm transition-colors',
                tab === t.key
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="rounded-xl border bg-card p-6">
          {tab === 'desc' ? (
            mod.description ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {mod.description}
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">暂无详细描述</div>
            )
          ) : (
            <div className="space-y-1">
              {versions.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">暂无版本</div>
              )}
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-accent/50"
                >
                  <span className="font-medium">v{v.version}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(v.file_size)}
                  </span>
                  {v.created_at && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 gap-1 text-xs"
                    onClick={() => onGet(mod, v.id)}
                  >
                    <Download className="size-3.5" />
                    获取
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧信息卡 */}
      <aside className="w-80 shrink-0">
        <div className="space-y-5 rounded-xl border bg-card p-5">
          <h2 className="text-2xl font-bold">{mod.title}</h2>

          <span className="inline-block rounded-md bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
            {mod.game?.name || 'OpenGal'}
          </span>

          <div className="grid grid-cols-3 gap-2 border-y py-4">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col items-center gap-0.5">
                <s.icon className="size-5 text-primary" />
                <span className="text-lg font-semibold">{s.value}</span>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>

          <Button className="h-11 w-full gap-2 text-sm" onClick={() => onGet(mod)}>
            <CircleCheck className="size-4" />
            一键安装
          </Button>

          <div className="space-y-2 border-t pt-4">
            <h4 className="text-sm font-medium">作者</h4>
            <div className="flex items-center gap-2.5">
              {mod.author?.avatar_url ? (
                <img src={mod.author.avatar_url} alt="" className="size-10 rounded-full" />
              ) : (
                <User className="size-8 text-muted-foreground" />
              )}
              <span className="font-medium">{mod.author?.username || '匿名'}</span>
              {mod.source_info?.source_type === 'original' && (
                <span className="text-xs text-emerald-500">原创</span>
              )}
              {mod.source_info?.source_type === 'repost' && (
                <span className="text-xs text-amber-500">转载</span>
              )}
            </div>
          </div>

          {publishDate && (
            <div className="flex items-center justify-between border-t pt-4 text-sm">
              <span className="text-muted-foreground">发布时间</span>
              <span>{publishDate}</span>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
