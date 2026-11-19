import * as React from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import type { LifeLogEntry } from '@core/role/types'
import type { RoleCardEntry } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  role: RoleCardEntry
}

type TraceFilter = 'all' | 'thought' | 'observation' | 'action'

const KIND_LABELS: Record<string, string> = {
  thought: '独白',
  observation: '见闻',
  action: '行动',
}

export function RoleTracePanel({ role }: Props): React.JSX.Element {
  const [traces, setTraces] = React.useState<LifeLogEntry[]>([])
  const [filter, setFilter] = React.useState<TraceFilter>('all')
  const [clearing, setClearing] = React.useState(false)

  const loadTraces = React.useCallback(async () => {
    const res = await window.opengal.role.lifeLogs(role.id, 200)
    if (res.success && res.data) {
      setTraces(res.data.filter((item) => item.kind !== 'diary').reverse())
    }
  }, [role.id])

  React.useEffect(() => {
    void loadTraces()
    const off = window.opengal.runtime.onChanged(() => {
      void loadTraces()
    })
    return () => {
      off()
    }
  }, [loadTraces])

  async function handleClearTraces(): Promise<void> {
    setClearing(true)
    try {
      await window.opengal.role.clearLifeLogs(role.id, 'traces')
      await loadTraces()
    } finally {
      setClearing(false)
    }
  }

  const visible = filter === 'all' ? traces : traces.filter((t) => t.kind === filter)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">自主行为轨迹</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            保留最近 200 条内心独白、浏览见闻、看屏观察与行动记录（清理轨迹不影响日记本）。
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => void loadTraces()}>
            <RefreshCw className="size-3.5" />
            刷新
          </Button>
          {traces.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleClearTraces()}
              disabled={clearing}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
              清理轨迹
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ['all', '全部'],
            ['thought', '内心独白'],
            ['observation', '见闻与观察'],
            ['action', '主动行动'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
              filter === key
                ? 'border-brand bg-brand/10 text-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
          当前筛选下暂无行为轨迹记录。
        </div>
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          {visible.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-1 px-3.5 py-3">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="rounded border bg-background px-1.5 py-0.5 font-medium text-foreground">
                    {KIND_LABELS[entry.kind] ?? entry.kind}
                  </span>
                  {entry.title ? <span className="font-medium text-foreground">{entry.title}</span> : null}
                </div>
                <span className="tabular-nums">
                  {new Date(entry.ts).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
