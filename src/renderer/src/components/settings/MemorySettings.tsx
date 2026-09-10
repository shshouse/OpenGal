import * as React from 'react'
import { Brain, Lock, LockOpen, Trash2, Plus, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCharacterStore } from '@/features/character/characterStore'
import { cn } from '@/lib/utils'
import type { MemoryFact, MemoryStory } from '@shared/types'

export function MemorySettings() {
  const activeId = useCharacterStore((s) => s.activeId)
  const characters = useCharacterStore((s) => s.list)
  const [facts, setFacts] = React.useState<MemoryFact[]>([])
  const [stories, setStories] = React.useState<MemoryStory[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [newFactText, setNewFactText] = React.useState('')
  const [adding, setAdding] = React.useState(false)

  const activeChar = characters.find((c) => c.id === activeId)
  const charName = activeChar?.displayName ?? activeChar?.name ?? '未选择角色'

  const load = React.useCallback(async () => {
    if (!activeId) return
    setLoading(true)
    setError(null)
    try {
      const res = await window.opengal.memory.get(activeId)
      if (res.success && res.data) {
        setFacts(res.data.facts)
        setStories(res.data.stories)
      } else {
        setError(res.error ?? '加载失败')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeId])

  React.useEffect(() => {
    void load()
  }, [load])

  const filteredFacts = React.useMemo(() => {
    if (!search.trim()) return facts
    const q = search.trim().toLowerCase()
    return facts.filter((f) => f.text.toLowerCase().includes(q))
  }, [facts, search])

  const filteredStories = React.useMemo(() => {
    if (!search.trim()) return stories
    const q = search.trim().toLowerCase()
    return stories.filter((s) => s.text.toLowerCase().includes(q))
  }, [stories, search])

  async function handleFreeze(factId: string, freeze: boolean): Promise<void> {
    if (!activeId) return
    const res = freeze
      ? await window.opengal.memory.freezeFact(activeId, factId)
      : await window.opengal.memory.unfreezeFact(activeId, factId)
    if (res.success) await load()
  }

  async function handleDelete(factId: string): Promise<void> {
    if (!activeId) return
    const res = await window.opengal.memory.deleteFact(activeId, factId)
    if (res.success) await load()
  }

  async function handleAdd(): Promise<void> {
    if (!activeId || !newFactText.trim()) return
    setAdding(true)
    try {
      const res = await window.opengal.memory.manualAdd(activeId, newFactText.trim(), 'user')
      if (res.success) {
        setNewFactText('')
        await load()
      }
    } finally {
      setAdding(false)
    }
  }

  function retentionPercent(f: MemoryFact): number {
    if (f.frozen_at) return 100
    if (f.valid_until && new Date(f.valid_until).getTime() < Date.now()) return 0
    const days = (Date.now() - new Date(f.last_confirmed_at).getTime()) / 86400000
    const stability = f.importance * 7
    return Math.round(Math.exp(-days / stability) * 100)
  }

  function isExpired(f: MemoryFact): boolean {
    return !!f.valid_until && new Date(f.valid_until).getTime() < Date.now()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Brain className="size-4" /> 记忆管理
          <span className="text-xs font-normal text-muted-foreground">({charName})</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索记忆..."
            className="pl-8"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => void handleAdd()} disabled={adding || !newFactText.trim()}>
          <Plus className="size-3.5" />
          添加
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          value={newFactText}
          onChange={(e) => setNewFactText(e.target.value)}
          placeholder="手动添加一条记忆"
          onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
        />
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          事实 ({filteredFacts.filter((f) => f.status === 'active').length} 条活跃)
        </h4>
        <div className="max-h-64 space-y-1 overflow-auto rounded-lg border">
          {filteredFacts.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">暂无记忆</div>
          ) : (
            filteredFacts.map((f) => {
              const expired = isExpired(f)
              const frozen = !!f.frozen_at
              const pct = retentionPercent(f)
              return (
                <div
                  key={f.id}
                  className={cn(
                    'flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0',
                    expired && 'opacity-50 line-through',
                    f.status === 'archived' && 'opacity-40'
                  )}
                >
                  <button
                    type="button"
                    title={frozen ? '解冻' : '冻结'}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => void handleFreeze(f.id, !frozen)}
                  >
                    {frozen ? <Lock className="size-3.5 text-amber-500" /> : <LockOpen className="size-3.5" />}
                  </button>
                  <span className="min-w-0 flex-1 truncate">{f.text}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {f.entity === 'user' ? '用户' : f.entity === 'character' ? '角色' : '关系'}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">重要度{f.importance}</span>
                  <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        pct >= 70 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-red-500'
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    title="删除"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => void handleDelete(f.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          故事 ({filteredStories.filter((s) => s.status === 'active').length} 条活跃)
        </h4>
        <div className="max-h-48 space-y-1 overflow-auto rounded-lg border">
          {filteredStories.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">暂无故事</div>
          ) : (
            filteredStories.map((s) => (
              <div
                key={s.id}
                className={cn(
                  'flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0',
                  s.status === 'archived' && 'opacity-40'
                )}
              >
                <span className="shrink-0 rounded-full border px-1.5 py-px text-[10px] text-muted-foreground">
                  {s.kind === 'promise' ? '约定' : s.kind === 'milestone' ? '里程碑' : s.kind === 'joke' ? '梗' : '事件'}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.text}</span>
                {s.due_at && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    截止 {s.due_at.slice(0, 10)}
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-muted-foreground">重要度{s.importance}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
