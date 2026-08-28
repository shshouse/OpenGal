import * as React from 'react'
import { Trash2, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

export function LogsView() {
  const entries = useLogsStore((s) => s.entries)
  const [levels, setLevels] = React.useState<Set<LogLevel>>(new Set(LOG_LEVELS))
  const [query, setQuery] = React.useState('')
  const viewportRef = React.useRef<HTMLDivElement | null>(null)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (!levels.has(e.level)) return false
      if (!q) return true
      return (
        e.source.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q) ||
        (e.details ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, levels, query])

  React.useEffect(() => {
    const el = viewportRef.current
    if (el) el.scrollTop = 0
  }, [filtered.length])

  function toggleLevel(level: LogLevel): void {
    setLevels((s) => {
      const next = new Set(s)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  return (
    <div className="flex h-[50vh] flex-col rounded-lg border">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <span className="mr-1 text-xs text-muted-foreground">{filtered.length}/{entries.length}</span>
        {LOG_LEVELS.map((lvl) => (
          <button
            key={lvl}
            onClick={() => toggleLevel(lvl)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors',
              levels.has(lvl) ? `${levelStyles[lvl]} bg-muted` : 'text-muted-foreground/40 hover:text-muted-foreground'
            )}
          >
            {levelLabel[lvl]}
          </button>
        ))}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索..."
          className="ml-auto h-6 max-w-[140px] text-xs"
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2"
          onClick={() => {
            const text = filtered.map(formatEntry).join('\n')
            void navigator.clipboard.writeText(text).catch(() => {})
          }}
          title="复制可见日志"
        >
          <Copy className="size-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2"
          onClick={() => {
            void window.opengal.logs.clear()
            useLogsStore.getState().clear()
          }}
          title="清空"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
      <div ref={viewportRef} className="flex-1 overflow-y-auto px-2 py-1 font-mono text-[10px] leading-relaxed">
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">暂无日志</div>
        ) : (
          filtered
            .slice()
            .reverse()
            .map((e) => (
            <div key={e.id} className="flex gap-1.5 py-0.5">
              <span className="shrink-0 text-muted-foreground/70">{formatLogTimestamp(e.timestamp)}</span>
              <span className={cn('w-8 shrink-0 text-right font-semibold', levelStyles[e.level])}>
                {levelLabel[e.level]}
              </span>
              <span className="w-14 shrink-0 truncate text-primary/80">{e.source}</span>
              <span className={cn('flex-1 whitespace-pre-wrap break-words', levelStyles[e.level])}>
                {e.message}
                {e.details ? <span className="block pl-3 text-muted-foreground/70">{e.details}</span> : null}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatEntry(e: LogEntry): string {
  const base = `[${formatLogTimestamp(e.timestamp)}] ${levelLabel[e.level]} ${e.source}: ${e.message}`
  return e.details ? `${base}\n  ${e.details}` : base
}
