import * as React from 'react'
import type { Live2DModelConfig } from '@shared/types'
import { Live2DStage } from '@/components/live2d/Live2DStage'
import { playMotionGroup } from '@/features/live2d/live2dBus'
import { mergeSavedTransform } from '@/features/live2d/modelTransform'

const DRAG_THRESHOLD_PX = 6

// 拖角色=挪窗口，点按=触发动作；手势须用 screenX/Y 判定（拖窗口时窗口跟随光标，clientX 几乎不变）
export default function PetView() {
  const [model, setModel] = React.useState<Live2DModelConfig | null>(null)
  const [bubble, setBubble] = React.useState<string | null>(null)
  const dragRef = React.useRef<{ x: number; y: number; dragging: boolean } | null>(null)

  React.useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  }, [])

  React.useEffect(() => window.opengal.pet.onBubble((text) => setBubble(text)), [])

  // 每条新气泡重置隐藏计时；回复停止更新后 5 秒自动消失
  React.useEffect(() => {
    if (!bubble) return
    const t = window.setTimeout(() => setBubble(null), 5000)
    return () => window.clearTimeout(t)
  }, [bubble])

  React.useEffect(() => {
    void (async () => {
      const cfg = await window.opengal.config.get()
      if (!cfg.success || !cfg.data) return
      const activeId = cfg.data.activeCharacterId
      if (activeId) {
        const fromCard = await window.opengal.model.resolveFromCard(activeId)
        if (fromCard.success && fromCard.data) {
          setModel(mergeSavedTransform(fromCard.data, cfg.data.model))
          return
        }
      }
      if (cfg.data.model?.modelUrl) {
        setModel(cfg.data.model)
        return
      }
      const def = await window.opengal.model.resolveDefault()
      if (def.success && def.data) setModel(def.data)
    })()
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    dragRef.current = { x: e.screenX, y: e.screenY, dragging: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    void window.opengal.pet.dragStart()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const s = dragRef.current
    if (!s) return
    if (e.buttons === 0) {
      dragRef.current = null
      return
    }
    if (!s.dragging) {
      if (Math.hypot(e.screenX - s.x, e.screenY - s.y) < DRAG_THRESHOLD_PX) return
      s.dragging = true
    }
    void window.opengal.pet.dragMove()
  }

  const endGesture = (e: React.PointerEvent<HTMLDivElement>): void => {
    const s = dragRef.current
    dragRef.current = null
    if (s && !s.dragging && e.type === 'pointerup') playMotionGroup('click')
  }

  return (
    <div
      className="relative h-full w-full select-none"
      style={{ background: 'transparent', cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      {bubble && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10">
          <div className="line-clamp-4 break-words rounded-2xl bg-black/55 px-3 py-2 text-xs leading-relaxed text-white backdrop-blur-sm">
            {bubble}
          </div>
        </div>
      )}
      <Live2DStage model={model} transparent interactive={false} transformGestures={false} />
    </div>
  )
}
