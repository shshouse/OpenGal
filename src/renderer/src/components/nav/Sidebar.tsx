/**
 * 左侧导航栏（桌面端）。
 *
 * 竖排图标 + 文字标签：设置 / 日志 + 快捷开关（桌宠、人物显隐）。
 * 设置是覆盖在当前页上的浮层（App 渲染 SettingsOverlay），点击只负责唤起；
 * 日志是全局模态浮层（LogsPanel），点击只负责唤起。两者都不切换主页面。
 */

import * as React from 'react'
import { Settings, Terminal, Cat, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  onOpenSettings: () => void
  petOpen: boolean
  onTogglePet: () => void
  showLive2D: boolean
  onToggleLive2D: () => void
  onOpenLogs: () => void
}

function RailButton({
  active,
  label,
  title,
  onClick,
  children
}: {
  active?: boolean
  label: string
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
        'flex w-full flex-col items-center justify-center gap-1 rounded-lg py-2 text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        active && 'bg-accent text-accent-foreground'
      )}
    >
      {children}
      <span className="text-[10px] leading-none">{label}</span>
    </button>
  )
}

export function Sidebar({
  onOpenSettings,
  petOpen,
  onTogglePet,
  showLive2D,
  onToggleLive2D,
  onOpenLogs
}: Props) {
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r bg-card/60 px-1.5 py-2">
      <RailButton label="设置" title="设置" onClick={onOpenSettings}>
        <Settings className="size-5" />
      </RailButton>
      <RailButton label="日志" title="运行日志" onClick={onOpenLogs}>
        <Terminal className="size-5" />
      </RailButton>

      <div className="my-2 h-px w-8 bg-border" />

      <RailButton
        label="桌宠"
        title={petOpen ? '关闭桌宠' : '打开桌宠'}
        active={petOpen}
        onClick={onTogglePet}
      >
        <Cat className="size-5" />
      </RailButton>
      <RailButton
        label="人物"
        title={showLive2D ? '隐藏人物' : '显示人物'}
        active={showLive2D}
        onClick={onToggleLive2D}
      >
        {showLive2D ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
      </RailButton>
    </nav>
  )
}
