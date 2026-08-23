import * as React from 'react'
import { Minus, Square, X, Sparkles, Copy, Terminal } from 'lucide-react'
import { useLogsStore } from '@/features/logs/logsStore'
import { useCharacterStore } from '@/features/character/characterStore'

export function TitleBar() {
  const [maximized, setMaximized] = React.useState(false)
  const togglePanel = useLogsStore((s) => s.setPanelOpen)
  const panelOpen = useLogsStore((s) => s.panelOpen)
  const character = useCharacterStore((s) => s.list.find((c) => c.id === s.activeId))
  const characterName = character?.displayName ?? character?.name ?? null
  const errorCount = useLogsStore((s) =>
    s.entries.reduce((n, e) => (e.level === 'error' || e.level === 'warn' ? n + 1 : n), 0),
  )

  React.useEffect(() => {
    window.opengal.window.isMaximized().then(setMaximized)
  }, [])

  function handleMinimize() {
    window.opengal.window.minimize()
  }

  function handleMaximize() {
    window.opengal.window.maximize()
    setMaximized((v) => !v)
  }

  function handleClose() {
    window.opengal.window.close()
  }

  return (
    <header
      className="flex h-9 select-none items-center justify-between border-b bg-background/80 backdrop-blur-sm"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 pl-3">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-xs font-semibold tracking-wide">OpenGal</span>
        {characterName && (
          <span className="text-[10px] text-muted-foreground">{characterName}</span>
        )}
      </div>

      <div
        className="flex h-full items-stretch"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => togglePanel(!panelOpen)}
          className="relative flex w-11 items-center justify-center transition-colors hover:bg-muted"
          aria-label="日志"
          title="运行日志"
        >
          <Terminal className="size-3.5" />
          {errorCount > 0 ? (
            <span className="absolute right-1.5 top-1.5 inline-flex h-3 min-w-3 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground">
              {errorCount > 99 ? '99+' : errorCount}
            </span>
          ) : null}
        </button>
        <button
          onClick={handleMinimize}
          className="flex w-11 items-center justify-center transition-colors hover:bg-muted"
          aria-label="Minimize"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex w-11 items-center justify-center transition-colors hover:bg-muted"
          aria-label="Maximize"
        >
          {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </button>
        <button
          onClick={handleClose}
          className="flex w-11 items-center justify-center transition-colors hover:bg-destructive hover:text-destructive-foreground"
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </header>
  )
}
