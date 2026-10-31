import * as React from 'react'
import { Minus, Square, X, Copy, Terminal } from 'lucide-react'
import { useLogsStore } from '@/features/logs/logsStore'

export function TitleBar() {
  const [maximized, setMaximized] = React.useState(false)
  const errorCount = useLogsStore((s) =>
    s.entries.reduce((n, e) => (e.level === 'error' || e.level === 'warn' ? n + 1 : n), 0),
  )

  React.useEffect(() => {
    void window.opengal.window.isMaximized().then(setMaximized)
  }, [])

  function handleMinimize() {
    void window.opengal.window.minimize()
  }

  function handleMaximize() {
    void window.opengal.window.maximize()
    setMaximized((v) => !v)
  }

  function handleClose() {
    void window.opengal.window.close()
  }

  return (
    <header
      className="flex h-9 select-none items-center justify-end border-b bg-background/80 backdrop-blur-sm"
      style={{ WebkitAppRegion: 'drag' as const } as React.CSSProperties}
    >
      <div
        className="flex h-full items-stretch"
        style={{ WebkitAppRegion: 'no-drag' as const } as React.CSSProperties}
      >
        <button
          onClick={() => window.dispatchEvent(new Event('opengal:open-logs'))}
          className="relative flex w-11 items-center justify-center transition-colors hover:bg-muted"
          aria-label="日志"
          title="运行日志"
        >
          <Terminal className="size-3.5" />
          {errorCount > 0 ? (
            <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold leading-none text-destructive-foreground">
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
