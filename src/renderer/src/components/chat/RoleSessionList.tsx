import * as React from 'react'
import { Plus, Search } from 'lucide-react'
import type { ChatMessage, RoleCardEntry } from '@shared/types'
import type { RoleRunningMap } from '@shared/role/runtime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/features/chat/chatStore'
import { formatPreviewTime, previewFromMessages, type SessionPreview } from '@/features/chat/sessionPreview'

interface Props {
  roles: RoleCardEntry[]
  activeId: string | null
  selectedId: string | null
  runningById: RoleRunningMap
  avatarUrl?: string | null
  onSelectRole: (roleId: string) => void
  onAddRole: () => void
}

function labelOf(role: RoleCardEntry): string {
  return role.displayName ?? role.name
}

export function RoleSessionList({
  roles,
  activeId,
  selectedId,
  runningById,
  avatarUrl,
  onSelectRole,
  onAddRole,
}: Props): React.JSX.Element {
  const [query, setQuery] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [summaries, setSummaries] = React.useState<Record<string, SessionPreview>>({})
  const sessions = useChatStore((s) => s.sessions)
  const messages = useChatStore((s) => s.messages)
  const sessionId = useChatStore((s) => s.sessionId)
  const roleIds = roles.map((role) => role.id).join('|')

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    const ids = roleIds ? roleIds.split('|') : []
    const tasks = ids.map(async (roleId) => {
      void useChatStore.getState().ensureHydrated(roleId)
      try {
        const res = await window.opengal.chatHistory.summaries(roleId)
        const last = res.success && res.data?.length ? res.data[res.data.length - 1] : null
        if (!cancelled && last) {
          setSummaries((prev) => {
            if (prev[roleId]?.text === last.text && prev[roleId]?.ts === last.end_ts) return prev
            return { ...prev, [roleId]: { text: last.text, ts: last.end_ts } }
          })
        }
      } catch {
        // 历史摘要不可用时使用未归档消息预览
      }
    })
    void Promise.allSettled(tasks).then(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [roleIds])

  const previews = React.useMemo(() => {
    const result: Record<string, SessionPreview> = {}
    for (const role of roles) {
      const source = role.id === sessionId ? messages : sessions[role.id]?.messages ?? []
      const preview = previewFromMessages(source as ChatMessage[])
      result[role.id] = preview.text ? preview : summaries[role.id] ?? preview
    }
    return result
  }, [roles, sessions, messages, sessionId, summaries])

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...roles]
      .filter((role) => {
        if (!needle) return true
        return labelOf(role).toLowerCase().includes(needle)
          || (previews[role.id]?.text ?? '').toLowerCase().includes(needle)
      })
      .sort((a, b) => (previews[b.id]?.ts ?? 0) - (previews[a.id]?.ts ?? 0))
  }, [roles, query, previews])

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r bg-card" aria-label="角色会话">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b px-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索角色或消息"
            aria-label="搜索角色或消息"
            className="h-8 pl-7"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onAddRole}
          title="添加角色"
          aria-label="添加角色"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-busy={loading}>
        {roles.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm">还没有角色</p>
            <p className="text-xs leading-relaxed text-muted-foreground">从角色市场装上第一个角色包。</p>
            <Button type="button" size="sm" onClick={onAddRole}>去角色市场</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">没有匹配的角色</div>
        ) : loading ? (
          <div className="space-y-1">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex animate-pulse items-center gap-2.5 px-2 py-2">
                <div className="size-9 shrink-0 rounded-md bg-muted" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3 w-1/2 rounded bg-muted" />
                  <div className="h-2.5 w-4/5 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((role) => {
              const label = labelOf(role)
              const running = runningById[role.id] === true
              const active = role.id === (selectedId ?? activeId)
              const preview = previews[role.id]
              const showAvatar = role.id === activeId && Boolean(avatarUrl)
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => onSelectRole(role.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                    active ? 'bg-brand/15' : 'hover:bg-accent/60',
                  )}
                >
                  <span
                    className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background text-sm"
                    style={{ color: role.color }}
                  >
                    {showAvatar ? (
                      <img src={avatarUrl ?? ''} alt="" className="h-full w-full object-cover" />
                    ) : (
                      label.slice(0, 1)
                    )}
                    <span
                      className={cn(
                        'absolute bottom-0 right-0 size-2 rounded-full ring-2 ring-background',
                        running ? 'bg-brand' : 'bg-muted-foreground/40',
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatPreviewTime(preview?.ts ?? null)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {preview?.text || (running ? '还没有消息' : '沉睡中')}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground tabular-nums">
        {roles.length} 个角色
      </div>
    </aside>
  )
}
