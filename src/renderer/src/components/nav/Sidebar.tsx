import * as React from 'react'
import { Settings, Terminal, Cat, Eye, EyeOff, Store, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ModuleLights } from '@/components/nav/ModuleLights'
import { useCharacterStore } from '@/features/character/characterStore'
import { useCharacterRuntimeStore } from '@/features/character/characterRuntimeStore'
import { isCharacterRunning } from '@shared/characterRuntime'

interface Props {
  avatarUrl?: string | null
  onAvatarClick: (characterId: string) => void
  onOpenChat: () => void
  chatActive: boolean
  onOpenSettings: () => void
  onOpenMarket: () => void
  marketActive: boolean
  petOpen: boolean
  onTogglePet: () => void
  showLive2D: boolean
  onToggleLive2D: () => void
  onOpenLogs: () => void
  logsActive: boolean
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
  avatarUrl,
  onAvatarClick,
  onOpenChat,
  chatActive,
  onOpenSettings,
  onOpenMarket,
  marketActive,
  petOpen,
  onTogglePet,
  showLive2D,
  onToggleLive2D,
  onOpenLogs,
  logsActive
}: Props) {
  const characters = useCharacterStore((state) => state.list)
  const activeId = useCharacterStore((state) => state.activeId)
  const runningById = useCharacterRuntimeStore((state) => state.byId)
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r bg-card/60 px-1.5 py-2">
      {characters.length > 0 ? (
        <div className="mb-1 flex flex-col items-center gap-1">
          {characters.map((character) => {
            const active = character.id === activeId
            const running = isCharacterRunning(runningById, character.id)
            const label = character.displayName ?? character.name
            return (
              <button
                key={character.id}
                type="button"
                title={`${label}：${running ? '运行中，点击休眠' : '沉睡中，点击唤醒'}`}
                onClick={() => onAvatarClick(character.id)}
                className={cn(
                  'relative flex size-11 items-center justify-center overflow-hidden rounded-full border bg-background text-xs transition-all',
                  active ? 'border-primary ring-2 ring-primary/40' : 'border-border',
                  !running && 'opacity-60 saturate-50'
                )}
              >
                {active && avatarUrl ? (
                  <img src={avatarUrl} alt={label} className="h-full w-full object-cover" />
                ) : (
                  <span style={{ color: character.color ?? undefined }}>
                    {label.slice(0, 1)}
                  </span>
                )}
                <span
                  className={cn(
                    'absolute bottom-0.5 right-0.5 size-2 rounded-full border border-background',
                    running ? 'bg-emerald-500' : 'bg-muted-foreground'
                  )}
                />
              </button>
            )
          })}
        </div>
      ) : (
        <button
          type="button"
          title="当前角色"
          onClick={onOpenChat}
          className="mb-1 flex size-11 items-center justify-center overflow-hidden rounded-full border border-border bg-background"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="当前角色" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground">角色</span>
          )}
        </button>
      )}
      <RailButton label="OPEN" title="OpenGal 主页" active={chatActive} onClick={onOpenChat}>
        <Sparkles className="size-5" />
      </RailButton>
      <RailButton label="市场" title="模组市场" active={marketActive} onClick={onOpenMarket}>
        <Store className="size-5" />
      </RailButton>
      <RailButton label="设置" title="设置" onClick={onOpenSettings}>
        <Settings className="size-5" />
      </RailButton>
      <RailButton label="日志" title="运行日志" active={logsActive} onClick={onOpenLogs}>
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

      <ModuleLights />
    </nav>
  )
}
