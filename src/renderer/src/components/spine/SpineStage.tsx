import * as React from 'react'
import type { SpriteFrames } from '@shared/types'
import { useStartupStore } from '@/features/startup/startupStore'
import { SpriteStage } from '@/components/sprite/SpriteStage'

interface SpinePlayerInstance {
  canvas?: HTMLCanvasElement
  renderer?: { dispose?: () => void }
  stopRendering?: () => void
}

declare global {
  interface Window {
    spine?: {
      SpinePlayer: new (element: HTMLElement, config: Record<string, unknown>) => SpinePlayerInstance
    }
  }
}

export function SpineStage({ skelUrl, atlasUrl, scale = 1, sleeping, mate = false, roleId = '', fallbackFrames }: {
  skelUrl: string
  atlasUrl: string
  scale?: number
  sleeping: boolean
  mate?: boolean
  roleId?: string
  fallbackFrames?: SpriteFrames
}) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [failure, setFailure] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (failure) return
    const host = hostRef.current
    const runtime = window.spine
    if (!host) return
    if (!runtime) {
      setFailure('立绘组件未加载')
      return
    }
    const fail = (message: string): void => {
      setFailure(message)
      window.opengal.logs.append('warn', 'spine', `立绘加载失败：${message}`, skelUrl)
      if (!mate) useStartupStore.getState().reportLive2d('failed', message)
    }
    let player: SpinePlayerInstance | null = null
    let cancelled = false

    // 首次渲染时容器可能还没完成布局，直接读取会得到 0x0，画面就什么都画不出来
    const boot = (): void => {
      if (cancelled || player) return
      if (!host.offsetWidth || !host.offsetHeight) return
      window.opengal.logs.append('info', 'spine', `挂载 ${skelUrl} 容器 ${host.offsetWidth}x${host.offsetHeight}`)
      try {
        player = new runtime.SpinePlayer(host, {
          skelUrl,
          atlasUrl,
          alpha: true,
          showControls: false,
          premultipliedAlpha: false,
          backgroundColor: '#00000000',
          success: () => {
            if (!mate) useStartupStore.getState().reportLive2d('ok')
          },
          error: (error: unknown) => {
            fail(error instanceof Error ? error.message : String(error))
          },
        })
      } catch (error) {
        fail(error instanceof Error ? error.message : '立绘加载失败')
      }
    }

    boot()
    const observer = new ResizeObserver(boot)
    observer.observe(host)

    return () => {
      cancelled = true
      observer.disconnect()
      try {
        player?.stopRendering?.()
        player?.renderer?.dispose?.()
        player?.canvas?.remove()
      } catch {
        // 卸载阶段的清理失败不影响后续界面
      }
    }
  }, [skelUrl, atlasUrl, mate, failure])

  if (failure && fallbackFrames) {
    return <SpriteStage frames={fallbackFrames} roleId={roleId} sleeping={sleeping} mate={mate} />
  }

  const transform = scale === 1 ? undefined : `scale(${scale})`
  const filter = sleeping ? 'saturate(0.55) brightness(0.7)' : undefined

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: mate ? 'transparent' : undefined }}>
      <div ref={hostRef} className="h-full w-full" style={{ transform, filter, transformOrigin: 'bottom center' }} />
      {failure ? (
        <div className="absolute inset-0 flex items-end justify-center pb-6 text-xs text-muted-foreground">
          立绘加载失败
        </div>
      ) : null}
    </div>
  )
}
