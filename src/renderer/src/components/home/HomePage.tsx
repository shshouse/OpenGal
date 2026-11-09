import * as React from 'react'
import { ArrowRight, Moon, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isRoleRunning, type RoleRunningMap } from '@shared/roleRuntime'
import type { BootStep, RoleCardEntry } from '@shared/types'
import { useUIStateStore } from '@/features/uiState/uiStateStore'

interface Props {
  roles: RoleCardEntry[]
  activeId: string | null
  runningById: RoleRunningMap
  steps: BootStep[]
  onOpenRole: (roleId: string) => void
  onToggleRunning: (roleId: string) => void
}

function StatusRow({
  label,
  value,
  danger
}: {
  label: string
  value: string
  danger?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('ml-auto truncate tabular-nums', danger ? 'text-destructive' : 'text-foreground')}>
        {value}
      </span>
    </div>
  )
}

export function HomePage({
  roles,
  activeId,
  runningById,
  steps,
  onOpenRole,
  onToggleRunning
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    useUIStateStore.getState().state.homeSelectedId ?? null,
  )
  const uiLoaded = useUIStateStore((s) => s.loaded)
  const savedSelectedId = useUIStateStore((s) => s.state.homeSelectedId)

  React.useEffect(() => {
    if (uiLoaded && savedSelectedId !== undefined) setSelectedId(savedSelectedId)
  }, [uiLoaded, savedSelectedId])
  const runningCount = roles.filter((role) => isRoleRunning(runningById, role.id)).length
  const selected = roles.find((role) => role.id === (selectedId ?? activeId)) ?? roles[0] ?? null
  const selectedRunning = selected ? isRoleRunning(runningById, selected.id) : false
  const selectedRoleId = selected?.id ?? null

  const [memoryCount, setMemoryCount] = React.useState<number | null>(null)
  const [memoryError, setMemoryError] = React.useState(false)

  React.useEffect(() => {
    setMemoryCount(null)
    setMemoryError(false)
    if (!selectedRoleId) return
    let cancelled = false
    void window.opengal.memory.get(selectedRoleId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) setMemoryCount(res.data.facts.length + res.data.stories.length)
      else setMemoryError(true)
    })
    return () => {
      cancelled = true
    }
  }, [selectedRoleId])

  const shapeLabel = selected?.performance.mode === 'live2d' ? 'Live2D' : '立绘'
  const memoryLabel = memoryError ? '读取失败' : memoryCount === null ? '读取中' : `${memoryCount} 条`
  const ttsStep = steps.find((step) => step.id === 'tts')
  const voiceDanger = ttsStep?.status === 'failed'
  const voiceLabel = voiceDanger
    ? '服务未连接'
    : ttsStep?.status !== 'ok'
      ? '待启动'
      : selected?.voice?.engine === 'genie'
        ? 'Genie'
        : selected?.voice?.engine === 'gpt-sovits'
          ? 'GPT-SoVITS'
          : '未配置'

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col border-r bg-card">
        <div className="flex h-11 shrink-0 items-center justify-between px-4">
          <span className="text-xs font-medium text-muted-foreground">角色</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {roles.length} 个 · {runningCount} 运行中
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {roles.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              还没有角色包
            </div>
          ) : (
            roles.map((role) => {
              const running = isRoleRunning(runningById, role.id)
              const label = role.displayName ?? role.name
              const active = selected?.id === role.id
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(role.id)
                    useUIStateStore.getState().patch({ homeSelectedId: role.id })
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 active:bg-accent',
                    active ? 'bg-accent' : 'hover:bg-accent/60'
                  )}
                >
                  <span
                    className="relative flex size-9 shrink-0 items-center justify-center rounded-full border bg-background text-xs"
                    style={{ color: role.color }}
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
                      {role.id === activeId ? ' · 当前角色' : ''}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="shrink-0 border-t px-4 py-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">运行状态</div>
          <div className="space-y-1.5 text-xs">
            <StatusRow label="形象" value={shapeLabel} />
            <StatusRow label="记忆" value={memoryLabel} danger={memoryError} />
            <StatusRow label="语音" value={voiceLabel} danger={voiceDanger} />
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
