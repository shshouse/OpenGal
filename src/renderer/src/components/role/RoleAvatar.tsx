import * as React from 'react'
import type { RoleAvatarRegion } from '@shared/types'
import { cn } from '@/lib/utils'

export function RoleAvatar({ src, region, label, className }: {
  src?: string | null
  region?: RoleAvatarRegion
  label: string
  className?: string
}): React.JSX.Element {
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  const style = region && size.width > 0 && size.height > 0
    ? {
        width: `${100 / (region.radius * 2)}%`,
        aspectRatio: `${size.width} / ${size.height}`,
        maxWidth: 'none',
        position: 'absolute' as const,
        left: `${50 - region.x / (region.radius * 2) * 100}%`,
        top: `calc(50% - ${region.y * size.height / (region.radius * size.width * 2) * 100}%)`,
      }
    : undefined
  return (
    <span className={cn('relative inline-block shrink-0 overflow-hidden rounded-full bg-muted', className)} title={label}>
      {src ? (
        <img
          src={src}
          alt={label}
          draggable={false}
          className={style ? 'block' : 'h-full w-full object-cover'}
          style={style}
          onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
      ) : <span className="flex h-full w-full items-center justify-center">{label.slice(0, 1)}</span>}
    </span>
  )
}
