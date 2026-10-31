import * as React from 'react'
import { Brain, CalendarClock, Milestone, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MemoryFact, MemoryStory } from '@shared/types'
import { summarizeMemories } from './memorySummary'
import { getErrorMessage } from '@shared/errors'

const ENTITY_LABELS = { user: '关于你', character: '关于角色', relationship: '关于关系' } as const

export function MemoryDashboard({ characterId }: { characterId: string }): React.JSX.Element {
  const [facts, setFacts] = React.useState<MemoryFact[]>([])
  const [stories, setStories] = React.useState<MemoryStory[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')

  const load = React.useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await window.opengal.memory.get(characterId)
      if (!res.success || !res.data) throw new Error(res.error || '记忆读取失败')
      setFacts(res.data.facts)
      setStories(res.data.stories)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [characterId])

  React.useEffect(() => { void load() }, [load])
  const summary = React.useMemo(() => summarizeMemories(facts, stories), [facts, stories])
  const maxEntity = Math.max(1, ...Object.values(summary.entityCounts))

  if (loading) return <div className="p-6 text-sm text-muted-foreground">正在读取记忆</div>
  if (error) return (
    <div className="space-y-3 p-6 text-sm">
      <p className="text-destructive">{error}</p>
      <Button variant="outline" size="sm" onClick={() => void load()}>
        <RefreshCw className="size-3.5" />重试
      </Button>
    </div>
  )

  return (
    <div className="space-y-6 p-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat icon={Brain} label="活跃记忆" value={summary.activeFacts} />
        <Stat icon={Milestone} label="角色经历" value={summary.activeStories} />
        <Stat icon={CalendarClock} label="待履行约定" value={summary.pendingPromises.length} />
      </div>

      {summary.activeFacts === 0 && summary.activeStories === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          还没有形成长期记忆
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-medium">事实分布</h3>
            <div className="space-y-2">
              {(Object.keys(ENTITY_LABELS) as Array<keyof typeof ENTITY_LABELS>).map((entity) => {
                const count = summary.entityCounts[entity]
                return (
                  <div key={entity} className="grid grid-cols-[72px_1fr_28px] items-center gap-3 text-xs">
                    <span className="text-muted-foreground">{ENTITY_LABELS[entity]}</span>
                    <div className="h-2 bg-muted">
                      <div
                        className="h-full rounded-r bg-primary/60"
                        style={{ width: `${(count / maxEntity) * 100}%` }}
                        title={`${ENTITY_LABELS[entity]} ${count} 条`}
                      />
                    </div>
                    <span className="text-right tabular-nums">{count}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-medium">最近里程碑</h3>
            {summary.milestones.length === 0 ? (
              <p className="text-xs text-muted-foreground">还没有记录里程碑</p>
            ) : (
              <div className="space-y-2">
                {summary.milestones.map((story) => (
                  <div key={story.id} className="border-l pl-3">
                    <time className="text-xs tabular-nums text-muted-foreground">
                      {new Date(story.occurred_at).toLocaleDateString()}
                    </time>
                    <p className="mt-1 text-sm leading-relaxed">{story.text}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />{label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}
