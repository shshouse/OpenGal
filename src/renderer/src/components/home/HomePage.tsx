import * as React from 'react'
import { ArrowRight, Moon, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isCharacterRunning, type CharacterRunningMap } from '@shared/characterRuntime'
import type { BootStep, BootStepStatus, RoleCardEntry } from '@shared/types'

interface Props {
  characters: RoleCardEntry[]
  activeId: string | null
  runningById: CharacterRunningMap
  steps: BootStep[]
  onOpenRole: (characterId: string) => void
  onToggleRunning: (characterId: string) => void
}

const STATUS_TEXT: Record<BootStepStatus, string> = {
  pending: '待启动',
  running: '加载中',
  ok: '正常',
  failed: '失败',
  skipped: '已跳过'
}

const STATUS_CLASS: Record<BootStepStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-foreground',
  ok: 'text-brand',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground'
}

const DOT_CLASS: Record<BootStepStatus, string> = {
  pending: 'bg-muted-foreground/35',
  running: 'bg-foreground/70',
  ok: 'bg-brand',
  failed: 'bg-destructive',
  skipped: 'bg-muted-foreground/25'
}

export function HomePage({
  characters,
  activeId,
  runningById,
  steps,
  onOpenRole,
  onToggleRunning
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const runningCount = characters.filter((character) => isCharacterRunning(runningById, character.id)).length
  const selected = characters.find((character) => character.id === (selectedId ?? activeId)) ?? characters[0] ?? null
  const selectedRunning = selected ? isCharacterRunning(runningById, selected.id) : false

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col border-r bg-card">
        <div className="flex h-11 shrink-0 items-center justify-between px-4">
          <span className="text-xs font-medium text-muted-foreground">角色</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {characters.length} 个 · {runningCount} 运行中
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {characters.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              还没有角色包
            </div>
          ) : (
            characters.map((character) => {
              const running = isCharacterRunning(runningById, character.id)
              const label = character.displayName ?? character.name
              const active = selected?.id === character.id
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => setSelectedId(character.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 active:bg-accent',
                    active ? 'bg-accent' : 'hover:bg-accent/60'
                  )}
                >
                  <span
                    className="relative flex size-9 shrink-0 items-center justify-center rounded-full border bg-background text-xs"
                    style={{ color: character.color }}
                  >
                    {label.slice(0, 1)}
                    <span
                      className={cn(
                        'absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background',
                        running ? 'bg-brand' : 'bg-muted-foreground/40'
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {running ? '运行中' : '沉睡中'}
                      {character.id === activeId ? ' · 当前角色' : ''}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="shrink-0 border-t px-4 py-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">运行环境</div>
          <div className="space-y-1.5">
            {steps.map((step) => (
              <div key={step.id} title={step.detail} className="flex items-center gap-2 text-xs">
                <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[step.status])} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{step.label}</span>
                <span className={cn('shrink-0 tabular-nums', STATUS_CLASS[step.status])}>
                  {STATUS_TEXT[step.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex h-full items-center justify-center px-8">
            <div className="max-w-xs text-center">
              <p className="text-sm font-medium">还没有角色</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                从市场装上第一个角色包，她就会住进这里。
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-8 py-10">
            <div className="flex items-start gap-5">
              <div
                className="flex size-16 shrink-0 items-center justify-center rounded-lg border bg-secondary text-xl font-medium"
                style={{ color: selected.color }}
              >
                {(selected.displayName ?? selected.name).slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <h1 className="truncate text-xl font-semibold tracking-tight">
                  {selected.displayName ?? selected.name}
                </h1>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      selectedRunning ? 'bg-brand' : 'bg-muted-foreground/40'
                    )}
                  />
                  <span>{selectedRunning ? '运行中' : '沉睡中'}</span>
                  {selected.id === activeId ? <span>· 当前角色</span> : null}
                </div>
              </div>
            </div>

            <p className="mt-8 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {selected.persona.description}
            </p>

            <div className="mt-8 flex items-center gap-2">
              <Button
                variant={selectedRunning ? 'outline' : 'default'}
                onClick={() => onToggleRunning(selected.id)}
              >
                {selectedRunning ? <Moon className="size-3.5" /> : <Play className="size-3.5" />}
                {selectedRunning ? '休眠' : '唤醒'}
              </Button>
              <Button
                variant={selectedRunning ? 'default' : 'outline'}
                onClick={() => onOpenRole(selected.id)}
              >
                <ArrowRight className="size-3.5" />
                进入角色
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
