import * as React from 'react'
import {
  Hammer,
  MessageCircle,
  PlusCircle,
  Settings,
  SlidersHorizontal,
  Store,
  Terminal,
} from 'lucide-react'
import type { AppViewName } from '@shared/ui/uiState'
import { cn } from '@/lib/utils'
import { useLogsStore } from '@/features/logs/logsStore'

interface Props {
  view: AppViewName
  onNavigate: (view: AppViewName) => void
}

const NAV = [
  { view: 'chat', label: '对话', icon: MessageCircle },
  { view: 'role', label: '角色与生活', icon: SlidersHorizontal },
  { view: 'create', label: '创建角色', icon: PlusCircle },
  { view: 'workshop', label: '模组工坊', icon: Hammer },
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
      className={cn(
        'relative flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
        active ? 'bg-brand/15 text-brand' : 'hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="size-5" />
      {badge && badge > 0 ? (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none text-destructive-foreground tabular-nums">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  )
}

export function NavRail({ view, onNavigate }: Props): React.JSX.Element {
  const errorCount = useLogsStore((state) =>
    state.entries.reduce(
      (count, entry) => (entry.level === 'error' || entry.level === 'warn' ? count + 1 : count),
      0,
    ),
  )

  return (
    <nav
      aria-label="主导航"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-card py-2.5"
    >
      {NAV.map((item) => (
        <RailButton
          key={item.view}
          icon={item.icon}
          label={item.label}
          active={view === item.view || (view === 'home' && item.view === 'role')}
          badge={item.view === 'logs' ? errorCount : undefined}
          onClick={() => onNavigate(item.view)}
        />
      ))}
    </nav>
  )
}
