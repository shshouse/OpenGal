import * as React from 'react'
import { ArrowRight, Moon, Pencil, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RoleDashboard } from '@/components/dashboard/RoleDashboard'
import { cn } from '@/lib/utils'
import type { BootStep, RoleCardEntry } from '@shared/types'

interface Props {
  role: RoleCardEntry | null
  running: boolean
  steps: BootStep[]
  onOpenRole: (roleId: string) => void
  onOpenSettings: (roleId: string) => void
  onToggleRunning: (roleId: string) => void
}

function StatusRow({
  label,
  value,
  danger,
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
  role,
  running,
  steps,
  onOpenRole,
  onOpenSettings,
  onToggleRunning,
}: Props): React.JSX.Element {
  const [memoryCount, setMemoryCount] = React.useState<number | null>(null)
  const [memoryError, setMemoryError] = React.useState(false)
  const roleId = role?.id ?? null

  React.useEffect(() => {
    setMemoryCount(null)
    setMemoryError(false)
    if (!roleId) return
    let cancelled = false
    void window.opengal.memory.get(roleId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) setMemoryCount(res.data.facts.length + res.data.stories.length)
      else setMemoryError(true)
    })
    return () => { cancelled = true }
  }, [roleId])

  if (!role) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-xs text-center">
          <p className="text-sm font-medium">还没有角色</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            从角色市场装上第一个角色包，她就会住进这里。
          </p>
        </div>
      </div>
    )
  }

  const label = role.displayName ?? role.name
  const shapeLabel = role.performance.mode === 'live2d' ? 'Live2D' : '立绘'
  const memoryLabel = memoryError ? '读取失败' : memoryCount === null ? '读取中' : `${memoryCount} 条`
  const ttsStep = steps.find((step) => step.id === 'tts')
  const voiceDanger = ttsStep?.status === 'failed'
  const voiceLabel = voiceDanger
    ? '服务未连接'
    : ttsStep?.status !== 'ok'
      ? '待启动'
      : role.voice?.engine === 'genie'
        ? 'Genie'
        : role.voice?.engine === 'gpt-sovits'
          ? 'GPT-SoVITS'
          : '未配置'

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <section className="shrink-0 border-b px-6 py-5">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-start gap-5">
            <div
              className="flex size-16 shrink-0 items-center justify-center rounded-lg border bg-secondary text-xl font-medium"
              style={{ color: role.color }}
            >
              {label.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <h1 className="truncate text-xl font-semibold tracking-tight">{label}</h1>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    running ? 'bg-brand' : 'bg-muted-foreground/40',
                  )}
                />
                <span>{running ? '运行中' : '沉睡中'}</span>
              </div>
            </div>
          </div>

          <p className="mt-5 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {role.persona.description}
          </p>

          <div className="mt-5 flex items-center gap-2">
            <Button variant={running ? 'outline' : 'default'} onClick={() => onToggleRunning(role.id)}>
              {running ? <Moon className="size-3.5" /> : <Play className="size-3.5" />}
              {running ? '休眠' : '唤醒'}
            </Button>
            <Button variant={running ? 'default' : 'outline'} onClick={() => onOpenRole(role.id)}>
              <ArrowRight className="size-3.5" />
              进入角色
            </Button>
            <Button variant="outline" onClick={() => onOpenSettings(role.id)}>
              <Pencil className="size-3.5" />
              编辑设定
            </Button>
          </div>

          <div className="mt-5 grid max-w-lg grid-cols-3 gap-4 text-xs">
            <StatusRow label="形象" value={shapeLabel} />
            <StatusRow label="记忆" value={memoryLabel} danger={memoryError} />
            <StatusRow label="语音" value={voiceLabel} danger={voiceDanger} />
          </div>
        </div>
      </section>

      <div className="min-h-0 flex-1 overflow-hidden">
        <RoleDashboard
          key={role.id}
          role={role}
          running={running}
          onToggleRunning={() => onToggleRunning(role.id)}
          hideHeader
        />
      </div>
    </div>
  )
}
