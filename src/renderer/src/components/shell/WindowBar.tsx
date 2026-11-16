import * as React from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { DRAG, NO_DRAG } from './drag'

export function WindowBar(): React.JSX.Element {
  const [maximized, setMaximized] = React.useState(false)

  React.useEffect(() => {
    void window.opengal.window.isMaximized().then(setMaximized)
  }, [])

  function handleMaximize(): void {
    void window.opengal.window.maximize()
    setMaximized((value) => !value)
  }

  return (
    <header
      className="flex h-9 shrink-0 select-none items-center border-b bg-card pl-3"
      style={DRAG}
    >
      <span className="text-xs font-medium text-muted-foreground">OpenGal</span>
      <div className="ml-auto flex h-full items-stretch" style={NO_DRAG}>
        <button
          type="button"
          onClick={() => void window.opengal.window.minimize()}
          className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="最小化"
          title="最小化"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={maximized ? '还原' : '最大化'}
          title={maximized ? '还原' : '最大化'}
        >
          {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </button>
        <button
          type="button"
          onClick={() => void window.opengal.window.close()}
          className="flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
          aria-label="关闭"
          title="关闭"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </header>
  )
}
