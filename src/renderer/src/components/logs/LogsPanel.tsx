import * as React from 'react'
import { X, Trash2, Copy, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useLogsStore } from '@/features/logs/logsStore'
import { LOG_LEVELS, formatLogTimestamp, type LogEntry, type LogLevel } from '@shared/log'

const levelStyles: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-amber-400',
  error: 'text-red-400',
}

const levelLabel: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR',
}

interface FilterState {
  levels: Set<LogLevel>
  query: string
}

export function LogsPanel({ forceOpen = false }: { forceOpen?: boolean } = {}) {
  const open = useLogsStore((s) => s.panelOpen)
  const close = useLogsStore((s) => s.setPanelOpen)
  const entries = useLogsStore((s) => s.entries)

  const [filter, setFilter] = React.useState<FilterState>({
    levels: new Set(LOG_LEVELS),
    query: '',
  })
  const [autoScroll, setAutoScroll] = React.useState(true)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)

  const filtered = React.useMemo(() => {
    const q = filter.query.trim().toLowerCase()
    return entries.filter((e) => {
      if (!filter.levels.has(e.level)) return false
      if (!q) return true
      return (
        e.source.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q) ||
        (e.details ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, filter])

  React.useEffect(() => {
    if (!autoScroll) return
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [filtered.length, autoScroll])

  if (!open && !forceOpen) return null

  async function handleClear() {
    await window.opengal.logs.clear()
    useLogsStore.getState().clear()
  }

  async function handleCopy() {
    const text = filtered.map(formatEntry).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // ignore: 某些 webview 没权限，无关紧要
    }
  }

  function toggleLevel(level: LogLevel) {
    setFilter((s) => {
      const next = new Set(s.levels)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return { ...s, levels: next }
    })
  }

  return (
    <div className={forceOpen
      ? 'flex h-full w-full flex-col bg-background'
      : 'fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm'
    }>
      <div className={forceOpen
        ? 'flex h-full min-h-0 w-full flex-1 flex-col'
        : 'm-2 flex h-[70vh] w-full max-w-5xl flex-col rounded-lg border bg-background shadow-2xl'
      }>
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <span className="text-sm font-semibold">运行日志</span>
          <span className="text-xs text-muted-foreground">{filtered.length}/{entries.length}</span>
          <div className="ml-2 flex items-center gap-1">
            {LOG_LEVELS.map((lvl) => (
              <button
                key={lvl}
                onClick={() => toggleLevel(lvl)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors',
                  filter.levels.has(lvl)
                    ? `${levelStyles[lvl]} bg-muted`
                    : 'text-muted-foreground/40 hover:text-muted-foreground',
                )}
              >
                {levelLabel[lvl]}
              </button>
            ))}
          </div>
          <Input
            value={filter.query}
            onChange={(e) => setFilter((s) => ({ ...s, query: e.target.value }))}
            placeholder="搜索..."
            className="ml-2 h-7 max-w-xs text-xs"
          />
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAutoScroll((v) => !v)}
              title={autoScroll ? '暂停自动滚动' : '继续自动滚动'}
            >
              {autoScroll ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCopy} title="复制可见日志">
              <Copy className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClear} title="清空">
              <Trash2 className="size-3.5" />
            </Button>
            {!forceOpen && (
              <Button size="sm" variant="ghost" onClick={() => close(false)} title="关闭">
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </header>
        <ScrollArea className="flex-1">
          <div
            ref={viewportRef}
            className="h-full overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
          >
            {filtered.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">暂无日志</div>
            ) : (
              filtered.map((e) => (
                <div key={e.id} className="flex gap-2 py-0.5">
                  <span className="shrink-0 text-muted-foreground/70">
                    {formatLogTimestamp(e.timestamp)}
                  </span>
                  <span
                    className={cn(
                      'w-10 shrink-0 text-right font-semibold',
                      levelStyles[e.level],
                    )}
                  >
                    {levelLabel[e.level]}
                  </span>
                  <span className="w-20 shrink-0 truncate text-primary/80">{e.source}</span>
                  <span className={cn('flex-1 whitespace-pre-wrap break-words', levelStyles[e.level])}>
                    {e.message}
                    {e.details ? (
                      <span className="block pl-4 text-muted-foreground/70">{e.details}</span>
                    ) : null}
                  </span>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function formatEntry(e: LogEntry): string {
  const base = `[${formatLogTimestamp(e.timestamp)}] ${levelLabel[e.level]} ${e.source}: ${e.message}`
  return e.details ? `${base}\n  ${e.details}` : base
}
