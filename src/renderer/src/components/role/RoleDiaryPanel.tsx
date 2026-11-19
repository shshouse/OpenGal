import * as React from 'react'
import { BookOpen, RefreshCw } from 'lucide-react'
import type { LifeLogEntry } from '@core/role/types'
import type { RoleCardEntry } from '@shared/types'
import { Button } from '@/components/ui/button'

interface Props {
  role: RoleCardEntry
}

const MOOD_LABELS: Record<string, string> = {
  neutral: '平静',
  happy: '愉快',
  sad: '低落',
  thinking: '思索',
  sleepy: '犯困',
  relaxed: '放松',
  excited: '兴奋',
}

export function RoleDiaryPanel({ role }: Props): React.JSX.Element {
  const [entries, setEntries] = React.useState<LifeLogEntry[]>([])
  const [loading, setLoading] = React.useState(true)

  const loadDiaries = React.useCallback(async () => {
    setLoading(true)
    const res = await window.opengal.role.lifeLogs(role.id, 200)
    if (res.success && res.data) {
      setEntries(res.data.filter((item) => item.kind === 'diary').reverse())
    }
    setLoading(false)
  }, [role.id])

  React.useEffect(() => {
    void loadDiaries()
    const off = window.opengal.runtime.onChanged(() => {
      void loadDiaries()
    })
    return () => {
      off()
    }
  }, [loadDiaries])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">她的日记本</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            日记独立永久保存，不会被日常思考轨迹挤掉；共 {entries.length} 篇。
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void loadDiaries()}>
          <RefreshCw className="size-3.5" />
          刷新
        </Button>
      </div>

      {loading ? (
        <div className="h-28 rounded-lg border bg-card/50" />
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card px-6 py-12 text-center">
          <BookOpen className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">还没有日记</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            在「运行与状态」开启 Life 自主生活后，她写下的个人随笔与心情记录会成篇收藏在这里。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map((entry) => (
            <article key={entry.id} className="rounded-xl border bg-card p-5">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
                <h3 className="text-sm font-semibold">{entry.title || '无题随笔'}</h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  {entry.mood ? (
                    <span className="rounded border bg-background px-1.5 py-0.5">
                      {MOOD_LABELS[entry.mood] ?? entry.mood}
                    </span>
                  ) : null}
                  <span>
                    {new Date(entry.ts).toLocaleString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </header>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                {entry.content}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
