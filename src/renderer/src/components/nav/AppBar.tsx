import * as React from 'react'
import {
  Cat,
  Copy,
  Eye,
  EyeOff,
  Minus,
  Settings,
  Sparkles,
  Square,
  Store,
  Terminal,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRoleStore } from '@/features/role/roleStore'
import { useRoleRuntimeStore } from '@/features/role/roleRuntimeStore'
import { useLogsStore } from '@/features/logs/logsStore'
import { isRoleRunning } from '@shared/roleRuntime'

export type AppView = 'home' | 'chat' | 'market' | 'settings' | 'logs'

const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

const NAV = [
  { view: 'home', label: '主页', icon: Sparkles },
  { view: 'market', label: '市场', icon: Store },
  { view: 'settings', label: '设置', icon: Settings },
  { view: 'logs', label: '日志', icon: Terminal }
] as const

interface Props {
  view: AppView
  onNavigate: (view: AppView) => void
  avatarUrl?: string | null
  onSelectRole: (roleId: string) => void
  mateOpen: boolean
  onToggleMate: () => void
  showLive2D: boolean
  onToggleLive2D: () => void
}

function ToggleButton({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </button>
  )
}

export function AppBar({
  view,
  onNavigate,
  avatarUrl,
  onSelectRole,
  mateOpen,
  onToggleMate,
  showLive2D,
  onToggleLive2D
}: Props): React.JSX.Element {
  const roles = useRoleStore((state) => state.list)
  const activeId = useRoleStore((state) => state.activeId)
  const runningById = useRoleRuntimeStore((state) => state.byId)
  const errorCount = useLogsStore((state) =>
    state.entries.reduce((n, entry) => (entry.level === 'error' || entry.level === 'warn' ? n + 1 : n), 0),
  )
  const [maximized, setMaximized] = React.useState(false)
  const activeView: AppView = view === 'chat' ? 'home' : view

  React.useEffect(() => {
    void window.opengal.window.isMaximized().then(setMaximized)
  }, [])

  function handleMaximize(): void {
    void window.opengal.window.maximize()
    setMaximized((value) => !value)
  }

  return (
    <header
      className="flex h-11 shrink-0 select-none items-stretch border-b bg-card [&_button]:active:bg-accent [&_button]:focus-visible:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-inset [&_button]:focus-visible:ring-ring/70"
      style={DRAG}
    >
      <nav className="flex items-center gap-0.5 pl-3" style={NO_DRAG}>
        {NAV.map((item) => {
          const active = activeView === item.view
          const badge = item.view === 'logs' && errorCount > 0
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <item.icon className="size-3.5" />
              <span>{item.label}</span>
              {badge ? (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none text-destructive-foreground">
                  {errorCount > 99 ? '99+' : errorCount}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="ml-3 flex items-center gap-1 border-l pl-3" style={NO_DRAG}>
        {roles.slice(0, 5).map((role) => {
          const active = role.id === activeId
          const running = isRoleRunning(runningById, role.id)
          const label = role.displayName ?? role.name
          return (
            <button
              key={role.id}
              type="button"
              title={`${label}：${running ? '运行中' : '沉睡中'}，点击进入对话`}
              onClick={() => onSelectRole(role.id)}
              className={cn(
                'relative flex size-8 items-center justify-center overflow-hidden rounded-full border text-xs transition-colors',
                active ? 'border-brand ring-1 ring-brand/50' : 'border-border hover:border-muted-foreground/50',
                !running && 'opacity-55'
              )}
            >
              {active && avatarUrl ? (
                <img src={avatarUrl} alt={label} className="h-full w-full object-cover" />
              ) : (
                <span style={{ color: role.color ?? undefined }}>{label.slice(0, 1)}</span>
              )}
              <span
                className={cn(
                  'absolute bottom-0 right-0 size-1.5 rounded-full ring-1 ring-background',
                  running ? 'bg-brand' : 'bg-muted-foreground/50'
                )}
              />
            </button>
          )
        })}
      </div>

      <div className="ml-auto flex items-stretch" style={NO_DRAG}>
        <div className="flex items-center gap-1 pr-2">
          <ToggleButton icon={Cat} label="相伴" active={mateOpen} onClick={onToggleMate} />
          <ToggleButton
            icon={showLive2D ? Eye : EyeOff}
            label="人物"
            active={showLive2D}
            onClick={onToggleLive2D}
          />
        </div>
        <div className="my-2.5 w-px bg-border" />
        <button
          type="button"
          onClick={() => void window.opengal.window.minimize()}
          className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="最小化"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={maximized ? '还原' : '最大化'}
        >
          {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </button>
        <button
          type="button"
          onClick={() => void window.opengal.window.close()}
          className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
          aria-label="关闭"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </header>
  )
}
