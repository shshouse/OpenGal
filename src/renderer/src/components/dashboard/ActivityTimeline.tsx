import * as React from 'react'
import { AlertCircle, MessageSquare, Radio, UserRound, Wrench } from 'lucide-react'
import type { ActivityEntry, ActivityKind } from '@/features/activity/activityStore'

const ICONS: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
  user: UserRound,
  speech: MessageSquare,
  tool: Wrench,
  system: Radio,
  error: AlertCircle,
}

export function ActivityTimeline({ entries, limit }: {
  entries: ActivityEntry[]
  limit?: number
}): React.JSX.Element {
  const visible = React.useMemo(
    () => [...entries].sort((a, b) => b.at - a.at).slice(0, limit ?? entries.length),
    [entries, limit],
  )
  if (visible.length === 0) {
    return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">还没有活动记录</div>
  }
  return (
    <div className="space-y-1">
      {visible.map((entry) => {
        const Icon = ICONS[entry.kind]
        return (
          <article key={entry.id} className="flex gap-3 rounded-md px-2 py-2 hover:bg-accent/50">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
              <Icon className={`size-3.5 ${entry.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium">{entry.title}</h3>
                <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
              {entry.detail && <p className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground">{entry.detail}</p>}
              {entry.ok === false && <p className="mt-1 text-xs text-destructive">未完成</p>}
            </div>
          </article>
        )
      })}
    </div>
  )
}
