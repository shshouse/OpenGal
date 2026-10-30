import * as React from 'react'
import {
  ArrowUp,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  Search,
  ScrollText,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useLogsStore } from '@/features/logs/logsStore'
import { LOG_LEVELS, formatLogTimestamp, type LogEntry, type LogLevel } from '@shared/log'

const LEVEL_META: Record<LogLevel, { label: string; short: string; text: string; dot: string }> = {
  error: { label: '错误', short: 'ERR', text: 'text-red-400', dot: 'bg-red-400' },
  warn: { label: '警告', short: 'WARN', text: 'text-amber-400', dot: 'bg-amber-400' },
  info: { label: '信息', short: 'INFO', text: 'text-foreground', dot: 'bg-foreground/45' },
  debug: { label: '调试', short: 'DBG', text: 'text-muted-foreground', dot: 'bg-muted-foreground/40' }
}

// 展示顺序：出错优先，方便排查
const LEVEL_ORDER: LogLevel[] = ['error', 'warn', 'info', 'debug']
const ALL_SOURCES = '__all__'
const PAGE_SIZE = 300

interface Props {
  onClose?: () => void
  embedded?: boolean
}

export function LogsPanel({ onClose, embedded = false }: Props): React.JSX.Element {
  const entries = useLogsStore((s) => s.entries)
  const hydrate = useLogsStore((s) => s.hydrate)

  const [levels, setLevels] = React.useState<Set<LogLevel>>(() => new Set(LOG_LEVELS))
  const [source, setSource] = React.useState<string>(ALL_SOURCES)
  const [query, setQuery] = React.useState('')
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [shown, setShown] = React.useState(PAGE_SIZE)
  const [following, setFollowing] = React.useState(true)
  const [unseen, setUnseen] = React.useState(0)
  const [flash, setFlash] = React.useState<string | null>(null)
  const [confirmClear, setConfirmClear] = React.useState(false)

  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const followingRef = React.useRef(true)
  const flashTimer = React.useRef<number | undefined>(undefined)

  // 进入页面时重新拉一次主进程缓冲，避免只在启动时取过、之后一直空白
  React.useEffect(() => {
    void hydrate()
  }, [hydrate])

  React.useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  React.useEffect(() => {
    if (!confirmClear) return
    const timer = window.setTimeout(() => setConfirmClear(false), 4000)
    return () => window.clearTimeout(timer)
  }, [confirmClear])

  function flashFor(message: string): void {
    setFlash(message)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 1800)
  }

  const setFollow = React.useCallback((next: boolean) => {
    followingRef.current = next
    setFollowing(next)
    if (next) setUnseen(0)
  }, [])

  const base = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (source !== ALL_SOURCES && e.source !== source) return false
      if (!q) return true
      return (
        e.source.toLowerCase().includes(q) ||
        e.message.toLowerCase().includes(q) ||
        (e.details ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, source, query])

  const counts = React.useMemo(() => {
    const result: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 }
    for (const e of base) result[e.level] += 1
    return result
  }, [base])

  const filtered = React.useMemo(
    () => base.filter((e) => levels.has(e.level)).sort((a, b) => b.timestamp - a.timestamp),
    [base, levels]
  )
  const visible = React.useMemo(() => filtered.slice(0, shown), [filtered, shown])

  const sources = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) map.set(e.source, (map.get(e.source) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [entries])

  // 来源被清空后不要停留在空筛选上
  React.useEffect(() => {
    if (source !== ALL_SOURCES && !sources.some(([name]) => name === source)) {
      setSource(ALL_SOURCES)
    }
  }, [source, sources])

  const levelsKey = LEVEL_ORDER.filter((l) => levels.has(l)).join(',')

  // 筛选条件变化：回到顶部重新看
  React.useEffect(() => {
    setShown(PAGE_SIZE)
    const el = scrollRef.current
    if (el) el.scrollTop = 0
    setFollow(true)
  }, [levelsKey, source, query, setFollow])

  // 新日志到达：跟随状态下钉在顶部，否则只累计未读数
  const newestId = entries.length > 0 ? entries[entries.length - 1].id : null
  const prevNewestId = React.useRef<string | null>(newestId)
  React.useEffect(() => {
    if (newestId === prevNewestId.current) return
    prevNewestId.current = newestId
    if (!newestId) return
    if (followingRef.current) {
      const el = scrollRef.current
      if (el) el.scrollTop = 0
    } else {
      setUnseen((n) => n + 1)
    }
  }, [newestId])

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atTop = el.scrollTop <= 4
    if (atTop !== followingRef.current) setFollow(atTop)
  }, [setFollow])

  function toggleLevel(level: LogLevel): void {
    setLevels((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  // 「全部」只做全选：点一下把筛选清空会把列表变白，容易让人以为日志没了
  function selectAllLevels(): void {
    setLevels(new Set(LOG_LEVELS))
  }

  function resetFilters(): void {
    setLevels(new Set(LOG_LEVELS))
    setSource(ALL_SOURCES)
    setQuery('')
  }

  function toggleExpanded(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCopy(): Promise<void> {
    if (filtered.length === 0) {
      flashFor('没有可复制的内容')
      return
    }
    try {
      await navigator.clipboard.writeText(filtered.map(formatEntry).join('\n'))
      flashFor(`已复制 ${filtered.length} 条`)
    } catch {
      flashFor('复制失败，请检查剪贴板权限')
    }
  }

  async function handleExport(): Promise<void> {
    if (filtered.length === 0) {
      flashFor('没有可导出的内容')
      return
    }
    try {
      const res = await window.opengal.logs.export(filtered.map(formatEntry).join('\n'))
      if (!res.success) flashFor(res.error ?? '导出失败')
      else if (res.data) flashFor('已导出日志文件')
    } catch (error) {
      flashFor(`导出失败：${(error as Error).message}`)
    }
  }

  async function handleReveal(): Promise<void> {
    try {
      const res = await window.opengal.logs.reveal()
      if (!res.success) flashFor(res.error ?? '打开日志目录失败')
    } catch (error) {
      flashFor(`打开日志目录失败：${(error as Error).message}`)
    }
  }

  async function handleClear(): Promise<void> {
    setConfirmClear(false)
    try {
      await window.opengal.logs.clear()
      useLogsStore.getState().clear()
      setExpanded(new Set())
      flashFor('已清空当前日志（磁盘文件保留）')
    } catch (error) {
      flashFor(`清空失败：${(error as Error).message}`)
    }
  }

  function jumpToLatest(): void {
    const el = scrollRef.current
    if (el) el.scrollTop = 0
    setFollow(true)
  }

  const errorCount = counts.error
  const emptyAll = entries.length === 0
  const allLevelsOn = levels.size === LOG_LEVELS.length

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className={cn(
        'flex shrink-0 items-center gap-3 border-b px-4',
        embedded ? 'min-h-12 flex-wrap gap-x-2 gap-y-1 py-2' : 'h-12',
      )}>
        <span className="text-sm font-semibold">运行日志</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {flash ??
            (filtered.length !== entries.length
              ? `命中 ${filtered.length} / 共 ${entries.length}`
              : `${entries.length} 条`)}
        </span>
        {errorCount > 0 && !flash ? (
          <button
            type="button"
            onClick={() => setLevels(new Set<LogLevel>(['error']))}
            className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-red-500/20"
            title="只看错误"
          >
            {errorCount} 个错误
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-0.5">
          <HeaderButton icon={Copy} label="复制" iconOnly={embedded} onClick={() => void handleCopy()} />
          <HeaderButton icon={Download} label="导出" iconOnly={embedded} onClick={() => void handleExport()} />
          <HeaderButton icon={FolderOpen} label="日志目录" iconOnly={embedded} onClick={() => void handleReveal()} />
          <button
            type="button"
            title={confirmClear ? '再点一次清空当前日志' : '清空当前日志（磁盘文件保留）'}
            onClick={() => {
              if (confirmClear) void handleClear()
              else setConfirmClear(true)
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
              confirmClear
                ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                : 'text-muted-foreground hover:bg-accent hover:text-red-400'
            )}
          >
            <Trash2 className="size-3.5" />
            {confirmClear && !embedded ? '确认清空' : !embedded ? '清空' : null}
          </button>
          {onClose ? (
            <button
              type="button"
              title="关闭"
              aria-label="关闭"
              onClick={onClose}
              className="ml-1 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div className={cn(
        'flex shrink-0 items-center gap-1.5 border-b px-4',
        embedded ? 'flex-wrap py-2' : 'h-10',
      )}>
        <button
          type="button"
          onClick={selectAllLevels}
          className={cn(
            'h-6 rounded px-2 text-xs transition-colors',
            allLevelsOn
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground/60 hover:bg-accent/50 hover:text-muted-foreground'
          )}
        >
          全部
        </button>
        {LEVEL_ORDER.map((level) => {
          const meta = LEVEL_META[level]
          const active = levels.has(level)
          return (
            <button
              key={level}
              type="button"
              onClick={() => toggleLevel(level)}
              className={cn(
                'flex h-6 items-center gap-1.5 rounded px-2 text-xs transition-colors',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground/50 hover:bg-accent/50 hover:text-muted-foreground'
              )}
            >
              <span className={cn('size-1.5 rounded-full', active ? meta.dot : 'bg-muted-foreground/25')} />
              {meta.label}
              <span className="tabular-nums text-muted-foreground/60">{counts[level]}</span>
            </button>
          )
        })}

        <div className="mx-1 h-4 w-px shrink-0 bg-border" />

        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className={cn('h-7 shrink-0 text-xs', embedded ? 'w-32' : 'w-40')}>
            <SelectValue placeholder="全部来源" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ALL_SOURCES} className="text-xs">
              全部来源（{entries.length}）
            </SelectItem>
            {sources.map(([name, count]) => (
              <SelectItem key={name} value={name} className="text-xs">
                {name}（{count}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className={cn('relative min-w-0', embedded ? 'w-full' : 'ml-auto max-w-sm flex-1')}>
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索消息、来源或详情"
            className="h-7 pl-7 pr-7 text-xs"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              title="清除搜索"
              className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto font-mono text-xs"
        >
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="flex size-11 items-center justify-center rounded-xl border bg-muted/40">
                {emptyAll ? (
                  <ScrollText className="size-5 text-muted-foreground" />
                ) : (
                  <Search className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="max-w-[440px] space-y-1.5 font-sans">
                <p className="text-sm font-medium text-foreground/85">
                  {emptyAll ? '还没有日志' : '没有匹配的日志'}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {emptyAll
                    ? '模型调用、语音合成、语音识别、记忆检索等模块的运行记录会实时出现在这里。'
                    : '试试放宽级别筛选，或清空搜索关键词。'}
                </p>
              </div>
              {emptyAll ? (
                <Button size="sm" variant="outline" onClick={() => void handleReveal()}>
                  <FolderOpen className="size-3.5" />
                  打开日志目录
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={resetFilters}>
                  清除筛选
                </Button>
              )}
            </div>
          ) : (
            <div className="py-1">
              {visible.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  query={query}
                  compact={embedded}
                  expanded={expanded.has(entry.id)}
                  onToggle={toggleExpanded}
                />
              ))}
              {filtered.length > visible.length ? (
                <div className="flex justify-center py-3">
                  <button
                    type="button"
                    onClick={() => setShown((n) => n + PAGE_SIZE)}
                    className="rounded-md border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    显示更早的 {Math.min(PAGE_SIZE, filtered.length - visible.length)} 条
                  </button>
                </div>
              ) : (
                <div className="py-3 text-center text-xs text-muted-foreground/40">
                  — 已经到底了 —
                </div>
              )}
            </div>
          )}
        </div>

        {!following && filtered.length > 0 ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-muted px-3 py-1.5 text-xs text-foreground shadow-lg transition-colors hover:bg-accent"
          >
            <ArrowUp className="size-3" />
            {unseen > 0 ? `回到最新 · ${unseen} 条新日志` : '回到最新'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function HeaderButton({
  icon: Icon,
  label,
  iconOnly = false,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  iconOnly?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="size-3.5" />
      {iconOnly ? null : label}
    </button>
  )
}

interface RowProps {
  entry: LogEntry
  query: string
  compact?: boolean
  expanded: boolean
  onToggle: (id: string) => void
}

const LogRow = React.memo(function LogRow({ entry, query, compact = false, expanded, onToggle }: RowProps) {
  const meta = LEVEL_META[entry.level]
  const hasDetails = Boolean(entry.details)
  return (
    <div
      onClick={hasDetails ? () => onToggle(entry.id) : undefined}
      className={cn(
        'flex items-start gap-2 border-l-2 border-transparent px-3 py-[3px] leading-[18px] transition-colors hover:bg-accent/40',
        compact && 'flex-wrap',
        hasDetails && 'cursor-pointer',
        entry.level === 'error' && 'border-l-red-500/60',
        entry.level === 'warn' && 'border-l-amber-500/60'
      )}
    >
      <span className="shrink-0 tabular-nums text-muted-foreground/55">
        {formatLogTimestamp(entry.timestamp)}
      </span>
      <span className={cn('w-10 shrink-0 font-semibold', meta.text)}>{meta.short}</span>
      <span
        className="w-20 shrink-0 truncate text-muted-foreground/80"
        title={entry.source}
      >
        {entry.source}
      </span>
      <div className={cn('min-w-0', compact ? 'w-full flex-none' : 'flex-1')}>
        <div
          className={cn(
            'whitespace-pre-wrap break-words',
            entry.level === 'debug' ? 'text-muted-foreground' : 'text-foreground/90'
          )}
        >
          {highlight(entry.message, query)}
        </div>
        {hasDetails ? (
          expanded ? (
            <pre className="mb-1 mt-1 whitespace-pre-wrap break-all rounded border border-border/60 bg-muted/30 px-2 py-1.5 text-xs leading-[16px] text-muted-foreground">
              {highlight(entry.details ?? '', query)}
            </pre>
          ) : (
            <span className="text-xs text-muted-foreground/45">详情 · 点击展开</span>
          )
        ) : null}
      </div>
      {hasDetails ? (
        <ChevronRight
          className={cn(
            'mt-[3px] size-3 shrink-0 text-muted-foreground/40 transition-transform',
            expanded && 'rotate-90'
          )}
        />
      ) : null}
    </div>
  )
})

function highlight(text: string, query: string): React.ReactNode {
  const needle = query.trim()
  if (!needle || !text) return text
  const lowerText = text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const hits: number[] = []
  let from = 0
  while (hits.length < 50) {
    const at = lowerText.indexOf(lowerNeedle, from)
    if (at < 0) break
    hits.push(at)
    from = at + lowerNeedle.length
  }
  if (hits.length === 0) return text

  const parts: React.ReactNode[] = []
  let cursor = 0
  hits.forEach((at, i) => {
    if (at > cursor) parts.push(text.slice(cursor, at))
    parts.push(
      <mark key={i} className="rounded-sm bg-amber-400/25 px-0.5 text-amber-200">
        {text.slice(at, at + needle.length)}
      </mark>
    )
    cursor = at + needle.length
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function formatEntry(entry: LogEntry): string {
  const head = `[${formatLogTimestamp(entry.timestamp)}] ${LEVEL_META[entry.level].short} ${entry.source}: ${entry.message}`
  if (!entry.details) return head
  return `${head}\n${entry.details
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')}`
}
