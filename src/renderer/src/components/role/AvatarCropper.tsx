import * as React from 'react'
import type { RoleAvatarRegion } from '@shared/types'
import { clampAvatarRegion } from '@shared/role/avatar'
import { Button } from '@/components/ui/button'

interface Props {
  src: string
  initial?: RoleAvatarRegion
  onSave: (region: RoleAvatarRegion) => void
  onCancel: () => void
  saving?: boolean
}

type DragMode = 'move' | 'resize' | 'new'

export function AvatarCropper({ src, initial, onSave, onCancel, saving = false }: Props): React.JSX.Element {
  const imageRef = React.useRef<HTMLImageElement>(null)
  const [size, setSize] = React.useState({ width: 1, height: 1 })
  const [region, setRegion] = React.useState<RoleAvatarRegion>(initial ?? { x: 0.5, y: 0.25, radius: 0.2 })
  const [loaded, setLoaded] = React.useState(false)
  const displaySize = React.useRef({ width: 1, height: 1 })
  const drag = React.useRef<{ mode: DragMode; startX: number; startY: number; original: RoleAvatarRegion } | null>(null)
  const ratio = size.width / size.height
  const clamp = (next: RoleAvatarRegion): RoleAvatarRegion => clampAvatarRegion(next, ratio)

  function point(event: React.PointerEvent): { x: number; y: number } {
    const rect = imageRef.current!.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  function pointerDown(event: React.PointerEvent): void {
    if (event.button !== 0 || !loaded) return
    const p = point(event)
    const distance = Math.hypot((p.x - region.x) * displaySize.current.width, (p.y - region.y) * displaySize.current.height)
    const radius = region.radius * displaySize.current.width
    const mode: DragMode = Math.abs(distance - radius) < 14 ? 'resize' : distance < radius ? 'move' : 'new'
    drag.current = { mode, startX: p.x, startY: p.y, original: region }
    if (mode === 'new') setRegion(clamp({ x: p.x, y: p.y, radius: 0 }))
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function pointerMove(event: React.PointerEvent): void {
    const active = drag.current
    if (!active) return
    const p = point(event)
    const original = active.original
    if (active.mode === 'move') {
      setRegion(clamp({ ...original, x: original.x + p.x - active.startX, y: original.y + p.y - active.startY }))
    } else {
      const anchor = active.mode === 'new' ? { x: active.startX, y: active.startY } : original
      const radius = Math.hypot((p.x - anchor.x) * displaySize.current.width, (p.y - anchor.y) * displaySize.current.height) / displaySize.current.width
      setRegion(clamp({ x: anchor.x, y: anchor.y, radius }))
    }
  }

  function keyboard(event: React.KeyboardEvent): void {
    const step = event.shiftKey ? 0.02 : 0.005
    if (event.key === 'ArrowLeft') setRegion(clamp({ ...region, x: region.x - step }))
    else if (event.key === 'ArrowRight') setRegion(clamp({ ...region, x: region.x + step }))
    else if (event.key === 'ArrowUp') setRegion(clamp({ ...region, y: region.y - step }))
    else if (event.key === 'ArrowDown') setRegion(clamp({ ...region, y: region.y + step }))
    else if (event.key === '+' || event.key === '=') setRegion(clamp({ ...region, radius: region.radius + step }))
    else if (event.key === '-') setRegion(clamp({ ...region, radius: region.radius - step }))
    else return
    event.preventDefault()
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-background p-4">
      <p className="text-xs text-muted-foreground">拖动选择头像范围，拖动圆内移动，拖动圆边调整大小。</p>
      <div
        className="relative mx-auto max-h-[55vh] max-w-full cursor-crosshair touch-none self-start overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="application"
        aria-label="头像区域，方向键移动，加减键调整大小"
        tabIndex={0}
        onKeyDown={keyboard}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => {
          if (drag.current) setRegion(drag.current.original)
          drag.current = null
        }}
      >
        <img
          ref={imageRef}
          src={src}
          alt="选择头像区域"
          draggable={false}
          className="block max-h-[55vh] max-w-full object-contain"
          onLoad={(event) => {
            const image = event.currentTarget
            setSize({ width: image.naturalWidth, height: image.naturalHeight })
            displaySize.current = { width: image.clientWidth, height: image.clientHeight }
            setRegion((value) => clampAvatarRegion(value, image.naturalWidth / image.naturalHeight))
            setLoaded(true)
          }}
        />
        {loaded && region.radius > 0 ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${displaySize.current.width} ${displaySize.current.height}`} aria-hidden="true">
            <defs><mask id="avatar-shade"><rect width="100%" height="100%" fill="white" /><circle cx={region.x * displaySize.current.width} cy={region.y * displaySize.current.height} r={region.radius * displaySize.current.width} fill="black" /></mask></defs>
            <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.55)" mask="url(#avatar-shade)" />
            <circle cx={region.x * displaySize.current.width} cy={region.y * displaySize.current.height} r={region.radius * displaySize.current.width} fill="none" stroke="white" strokeWidth="2" />
            <circle cx={(region.x + region.radius) * displaySize.current.width} cy={region.y * displaySize.current.height} r="5" fill="white" />
          </svg>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>取消</Button>
        <Button type="button" size="sm" onClick={() => onSave(clamp(region))} disabled={!loaded || region.radius < 0.02 || saving}>{saving ? '保存中' : '保存头像区域'}</Button>
      </div>
    </div>
  )
}
