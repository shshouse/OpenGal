/**
 * 左侧导航栏（桌面端）。
 *
 * 图标轨道：首页 / 设置 / 日志 + 快捷开关（桌宠、人物显隐）。
 * 日志是全局模态浮层（LogsPanel），点击只负责唤起，不参与 view 切换。
 */

import * as React from 'react'
import { Home, Settings, Terminal, Cat, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export type NavView = 'home' | 'settings'

interface Props {
  view: NavView
  onViewChange: (view: NavView) => void
  petOpen: boolean
  onTogglePet: () => void
  showLive2D: boolean
  onToggleLive2D: () => void
  onOpenLogs: () => void
}

function RailButton({
  active,
  title,
  onClick,
  children
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        active && 'bg-accent text-accent-foreground'
      )}
    >
      {children}
    </button>
  )
}

export function Sidebar({
  view,
  onViewChange,
  petOpen,
  onTogglePet,
  showLive2D,
  onToggleLive2D,
  onOpenLogs
}: Props) {
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-card/60 py-2">
      <RailButton
        title="首页"
        active={view === 'home'}
        onClick={() => onViewChange('home')}
      >
        <Home className="size-5" />
      </RailButton>
      <RailButton
        title="设置"
        active={view === 'settings'}
        onClick={() => onViewChange('settings')}
      >
        <Settings className="size-5" />
      </RailButton>
      <RailButton title="运行日志" onClick={onOpenLogs}>
        <Terminal className="size-5" />
      </RailButton>

      <div className="my-2 h-px w-8 bg-border" />

      <RailButton
        title={petOpen ? '关闭桌宠' : '打开桌宠'}
        active={petOpen}
        onClick={onTogglePet}
      >
        <Cat className="size-5" />
      </RailButton>
      <RailButton
        title={showLive2D ? '隐藏人物' : '显示人物'}
        active={showLive2D}
        onClick={onToggleLive2D}
      >
        {showLive2D ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
      </RailButton>
    </nav>
  )
}
