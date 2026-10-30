import * as React from 'react'
import { PanelRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_RATIO = 0.5
const MIN_RATIO = 0.35
const MAX_RATIO = 0.65
const COLLAPSE_RATIO = 0.82

function clampRatio(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value))
}

interface Props {
  chat: React.ReactNode
  stage: React.ReactNode
}

export function ChatWorkspace({ chat, stage }: Props): React.JSX.Element {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const dividerRef = React.useRef<HTMLDivElement>(null)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = React.useState(DEFAULT_RATIO)
  const [collapsed, setCollapsed] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  // 收起时冻结舞台宽度：画布留在一个非零尺寸里，避免 resize(0) 把模型算成 NaN
  const [frozenStageWidth, setFrozenStageWidth] = React.useState<number | null>(null)
  // 拖动开始时的比例，Esc 恢复到这里
  const restoreRef = React.useRef(DEFAULT_RATIO)

  React.useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent): void => {
      const el = rootRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      const next = (e.clientX - rect.left) / rect.width
      if (next >= COLLAPSE_RATIO) {
        const width = stageRef.current?.clientWidth
        if (width) setFrozenStageWidth(width)
        setCollapsed(true)
        setDragging(false)
        return
      }
      setCollapsed(false)
      setRatio(clampRatio(next))
    }
    const onUp = (): void => setDragging(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // 只在拖动中或分隔条持有焦点时生效，避免和设置弹窗的 Esc 抢事件
      if (!dragging && document.activeElement !== dividerRef.current) return
      setDragging(false)
      setCollapsed(false)
      setRatio(clampRatio(restoreRef.current))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dragging])

  function startDrag(): void {
    restoreRef.current = ratio
    setDragging(true)
  }

  function resetToEven(): void {
    setDragging(false)
    setCollapsed(false)
    setRatio(DEFAULT_RATIO)
  }

  return (
    <div
      ref={rootRef}
      className={cn('relative flex h-full w-full overflow-hidden', dragging && 'select-none')}
    >
      <div
        className="flex h-full min-w-0 flex-col bg-background"
        style={{ width: collapsed ? '100%' : `${ratio * 100}%` }}
      >
        {chat}
      </div>

      {!collapsed && (
        <div
          ref={dividerRef}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整两侧区域宽度"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={Math.round(MIN_RATIO * 100)}
          aria-valuemax={Math.round(MAX_RATIO * 100)}
          tabIndex={0}
          onPointerDown={startDrag}
          onDoubleClick={resetToEven}
          className={cn(
            'relative z-20 w-px shrink-0 cursor-col-resize bg-border outline-none',
            "after:absolute after:inset-y-0 after:-left-1.5 after:w-3 after:content-['']",
            'transition-colors hover:bg-foreground/30 focus-visible:bg-foreground/40',
            dragging && 'bg-foreground/40'
          )}
        />
      )}

      <div
        className={cn(
          'relative h-full overflow-hidden',
          collapsed ? 'w-0 shrink-0' : 'min-w-0 flex-1'
        )}
      >
        <div
          ref={stageRef}
          className="h-full"
          style={{ width: collapsed && frozenStageWidth ? frozenStageWidth : '100%' }}
        >
          {stage}
        </div>
        {dragging && <div className="absolute inset-0 z-30 cursor-col-resize" aria-hidden />}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={() => {
            setCollapsed(false)
            setRatio(clampRatio(restoreRef.current))
          }}
          className="edge absolute right-3 top-3 z-30 flex h-7 items-center gap-1 rounded-full bg-background/90 px-2.5 text-xs text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
        >
          <PanelRight className="size-3" />
          显示角色
        </button>
      )}
    </div>
  )
}
