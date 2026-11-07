import * as React from 'react'
import { Users, RefreshCw, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRoleStore } from '@/features/role/roleStore'
import { cn } from '@/lib/utils'

export function RoleSettings() {
  const list = useRoleStore((s) => s.list)
  const activeId = useRoleStore((s) => s.activeId)
  const loading = useRoleStore((s) => s.loading)
  const error = useRoleStore((s) => s.error)
  const loadRoles = useRoleStore((s) => s.loadRoles)
  const setActive = useRoleStore((s) => s.setActive)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4" /> 角色管理
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadRoles(activeId)}
          disabled={loading}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          重新扫描
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {list.length === 0 && !loading && (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          mods/role-card 下未发现可用角色卡
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {list.map((card) => {
          const active = card.id === activeId
          return (
            <button
              key={card.id}
              onClick={() => void setActive(card.id)}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                active
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-primary/40 hover:bg-accent/30',
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span
                  className="truncate text-sm font-medium"
                  style={card.color ? { color: card.color } : undefined}
                >
                  {card.displayName ?? card.name}
                </span>
                {active && <Check className="size-3.5 shrink-0 text-primary" />}
              </div>
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {card.persona.description || card.persona.personality}
              </span>
              <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                <span className="rounded-full border px-1.5 py-px">
                  TTS: {card.voice?.engine ?? '—'}
                </span>
                <span className="rounded-full border px-1.5 py-px">说话语言: {card.language || '未指定'}</span>
                {card.llm?.provider && (
                  <span className="rounded-full border px-1.5 py-px">
                    LLM: {card.llm.provider}
                  </span>
                )}
                {card.windowMode && (
                  <span className="rounded-full border px-1.5 py-px">
                    {card.windowMode}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
