import * as React from 'react'
import { useStartupStore } from '@/features/startup/startupStore'

interface SpinePlayerInstance {
  dispose: () => void
}

declare global {
  interface Window {
    spine?: {
      SpinePlayer: new (element: HTMLElement, config: Record<string, unknown>) => SpinePlayerInstance
    }
  }
}

export function SpineStage({ skelUrl, atlasUrl, scale = 1, sleeping, mate = false }: {
  skelUrl: string
  atlasUrl: string
  scale?: number
  sleeping: boolean
  mate?: boolean
}) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    const host = hostRef.current
    const runtime = window.spine
    if (!host) return
    if (!runtime) {
      setFailed(true)
      if (!mate) useStartupStore.getState().reportLive2d('failed', '立绘组件未加载')
      return
    }
    let player: SpinePlayerInstance | null = null
    try {
      player = new runtime.SpinePlayer(host, {
        skelUrl,
        atlasUrl,
        alpha: true,
        showControls: false,
        premultipliedAlpha: false,
        backgroundColor: '#00000000',
      })
      setFailed(false)
      if (!mate) useStartupStore.getState().reportLive2d('ok')
    } catch (error) {
      setFailed(true)
      if (!mate) {
        useStartupStore.getState().reportLive2d('failed', error instanceof Error ? error.message : '立绘加载失败')
      }
    }
    return () => {
      player?.dispose()
    }
  }, [skelUrl, atlasUrl, mate])

  const transform = scale === 1 ? undefined : `scale(${scale})`
  const filter = sleeping ? 'saturate(0.55) brightness(0.7)' : undefined

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: mate ? 'transparent' : undefined }}>
      <div ref={hostRef} className="h-full w-full" style={{ transform, filter, transformOrigin: 'bottom center' }} />
      {failed ? (
        <div className="absolute inset-0 flex items-end justify-center pb-6 text-xs text-muted-foreground">
          立绘加载失败
        </div>
      ) : null}
    </div>
  )
}
