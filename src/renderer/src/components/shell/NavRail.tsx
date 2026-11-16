import * as React from 'react'
import { Cat, Eye, EyeOff, MessageCircle, Settings, Sparkles, Store, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLogsStore } from '@/features/logs/logsStore'
import type { AppViewName } from '@shared/ui/uiState'

interface Props {
  view: AppViewName
  onNavigate: (view: AppViewName) => void
  mateOpen: boolean
  onToggleMate: () => void
  showLive2D: boolean
  onToggleLive2D: () => void
}

const NAV = [
  { view: 'home', label: '角色详情', icon: Sparkles },
  { view: 'chat', label: '对话', icon: MessageCircle },
  { view: 'market', label: '角色市场', icon: Store },
  { view: 'settings', label: '设置', icon: Settings },
  { view: 'logs', label: '日志', icon: Terminal },
] as const

function RailButton({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
  badge?: number
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      aria-pressed={active === undefined ? undefined : active}
      className={cn(
        'relative flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
        active ? 'bg-brand/15 text-brand' : 'hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="size-5" />
      {badge && badge > 0 ? (
        <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none text-destructive-foreground tabular-nums">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  )
}

export function NavRail({
  view,
  onNavigate,
  mateOpen,
  onToggleMate,
  showLive2D,
  onToggleLive2D,
}: Props): React.JSX.Element {
  const errorCount = useLogsStore((state) =>
    state.entries.reduce(
      (count, entry) => (entry.level === 'error' || entry.level === 'warn' ? count + 1 : count),
      0,
    ),
  )

  return (
    <nav
      aria-label="主导航"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-card py-2"
    >
      {NAV.map((item) => (
        <RailButton
          key={item.view}
          icon={item.icon}
          label={item.label}
          active={view === item.view}
          badge={item.view === 'logs' ? errorCount : undefined}
          onClick={() => onNavigate(item.view)}
        />
      ))}
      <div className="mt-auto flex flex-col items-center gap-1 border-t pt-2">
        <RailButton
          icon={Cat}
          label="相伴窗口"
          active={mateOpen}
          onClick={onToggleMate}
        />
        <RailButton
          icon={showLive2D ? Eye : EyeOff}
          label="人物舞台"
          active={showLive2D}
          onClick={onToggleLive2D}
        />
      </div>
    </nav>
  )
}
