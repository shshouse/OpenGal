import * as React from 'react'
import { Brain, Lock, LockOpen, Trash2, Plus, RefreshCw, RotateCcw, Search, Quote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRoleStore } from '@/features/role/roleStore'
import { rebuildMemoryIndex } from '@/features/memory/memoryService'
import { cn } from '@/lib/utils'
import type { MemoryChange, MemoryFact, MemoryStory } from '@shared/types'
import { getErrorMessage } from '@shared/errors'
import { useUIStateStore } from '@/features/uiState/uiStateStore'

function sourceText(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object' && 'content' in parsed) {
      const inner = (parsed as { content?: unknown }).content
      if (typeof inner === 'string') return inner
    }
    return content
  } catch {
    return content
  }
}

const ACTOR_LABELS: Record<string, string> = {
  llm: '自动整理',
  arbitration: '自动整理',
  user: '手动修改',
  system: '系统',
}

function statusLabel(value: string | null): string {
  if (value === 'active') return '活跃'
  if (value === 'archived') return '已归档'
  if (value === 'superseded') return '已替代'
  return value ?? '空'
}

function changeLabel(change: MemoryChange): string {
  if (change.action === 'insert') return '创建'
  if (change.action === 'delete') return '删除'
  if (change.field === 'state') return `状态 ${statusLabel(change.old_value)} → ${statusLabel(change.new_value)}`
  if (change.field === 'pinned') return change.new_value === '1' ? '固定' : '取消固定'
  if (change.field === 'confirmed_at') return '再次确认'
  if (change.field === 'frozen_at') return change.new_value ? '冻结' : '解冻'
  return '更新'
}

export function MemorySettings() {
  const activeId = useRoleStore((s) => s.activeId)
  const roles = useRoleStore((s) => s.list)
  const [facts, setFacts] = React.useState<MemoryFact[]>([])
  const [stories, setStories] = React.useState<MemoryStory[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const uiLoaded = useUIStateStore((s) => s.loaded)
  const savedSearch = useUIStateStore((s) => s.state.memorySearch)
  const searchRestored = React.useRef(false)
  const [search, setSearch] = React.useState(savedSearch ?? '')
  const [newFactText, setNewFactText] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  const [rebuilding, setRebuilding] = React.useState(false)
  const [openSource, setOpenSource] = React.useState<string | null>(null)
  const [sources, setSources] = React.useState<Record<string, Array<{ id: number; role: string; content: string; ts: number }>>>({})
  const [changes, setChanges] = React.useState<Record<string, MemoryChange[]>>({})

  const activeChar = roles.find((c) => c.id === activeId)
  const charName = activeChar?.displayName ?? activeChar?.name ?? '未选择角色'

  React.useEffect(() => {
    if (!uiLoaded || searchRestored.current) return
    searchRestored.current = true
    if (savedSearch !== undefined) setSearch(savedSearch)
  }, [uiLoaded, savedSearch])

  React.useEffect(() => {
    if (!searchRestored.current) return
    const timer = window.setTimeout(() => {
      useUIStateStore.getState().patch({ memorySearch: search })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

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
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [activeId])

  React.useEffect(() => {
    void load()
  }, [load])

  const loadChanges = React.useCallback(async (memoryId: string): Promise<void> => {
    if (!activeId) return
    const res = await window.opengal.memory.changes(activeId, memoryId, 20)
    if (res.success && res.data) setChanges((prev) => ({ ...prev, [memoryId]: res.data ?? [] }))
  }, [activeId])

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
    if (res.success) {
      await load()
      if (openSource === factId) await loadChanges(factId)
    }
  }

  async function handleDelete(factId: string): Promise<void> {
    if (!activeId) return
    const res = await window.opengal.memory.deleteFact(activeId, factId)
    if (res.success) await load()
  }

  async function toggleSource(id: string): Promise<void> {
    if (!activeId) return
    if (openSource === id) {
      setOpenSource(null)
      return
    }
    setOpenSource(id)
    if (!sources[id]) {
      const res = await window.opengal.memory.evidence(activeId, id)
      if (res.success && res.data) setSources((prev) => ({ ...prev, [id]: res.data ?? [] }))
    }
    if (!changes[id]) await loadChanges(id)
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

  async function handleRebuild(): Promise<void> {
    if (!activeId) return
    setRebuilding(true)
    try {
      await rebuildMemoryIndex(activeId)
      await load()
    } finally {
      setRebuilding(false)
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
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void handleRebuild()} disabled={loading || rebuilding}>
            <RotateCcw className={cn('size-3.5', rebuilding && 'animate-spin')} />
            从原文重建
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            刷新
          </Button>
        </div>
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
                <React.Fragment key={f.id}>
                  <div
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
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {f.entity === 'user' ? '用户' : f.entity === 'character' ? '角色' : '关系'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">重要度{f.importance}</span>
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
                    title="来源与变更"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => void toggleSource(f.id)}
                  >
                    <Quote className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => void handleDelete(f.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  </div>
                  {openSource === f.id && (
                    <div className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      <div>
                        {(sources[f.id] ?? []).length === 0 ? (
                          <span>这条记忆没有记录来源原话</span>
                        ) : (
                          (sources[f.id] ?? []).map((m) => (
                            <div key={`${f.id}-${m.id}`} className="flex gap-2 py-0.5">
                              <span className="shrink-0 tabular-nums">
                                {new Date(m.ts).toLocaleDateString()}
                              </span>
                              <span className="min-w-0 flex-1">{sourceText(m.content)}</span>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="mt-2 border-t pt-2">
                        <div className="mb-1 font-medium">变更记录</div>
                        {(changes[f.id] ?? []).length === 0 ? (
                          <span>暂无变更记录</span>
                        ) : (
                          (changes[f.id] ?? []).map((c) => (
                            <div key={c.seq} className="flex gap-2 py-0.5">
                              <span className="shrink-0 tabular-nums">
                                {new Date(c.ts).toLocaleDateString()}
                              </span>
                              <span className="min-w-0 flex-1">{changeLabel(c)}</span>
                              <span className="shrink-0">{ACTOR_LABELS[c.actor] ?? ''}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </React.Fragment>
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
                <span className="shrink-0 rounded-full border px-1.5 py-px text-xs text-muted-foreground">
                  {s.kind === 'promise' ? '约定' : s.kind === 'milestone' ? '里程碑' : s.kind === 'joke' ? '梗' : '事件'}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.text}</span>
                {s.due_at && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    截止 {s.due_at.slice(0, 10)}
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">重要度{s.importance}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
