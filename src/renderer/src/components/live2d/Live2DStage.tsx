import * as React from 'react'
import * as PIXI from 'pixi.js'
import { Loader2, AlertCircle } from 'lucide-react'
import type { Live2DModelConfig } from '@shared/types'
import { registerLive2DModel } from '@/features/live2d/live2dBus'
import { useLogsStore } from '@/features/logs/logsStore'

// Set PIXI on window BEFORE pixi-live2d-display is imported.
// The library checks window.PIXI at module init time for Ticker integration.
;(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI

// Lazy-loaded Live2DModel class. We use dynamic import so the module evaluates
// AFTER window.PIXI and window.Live2DCubismCore are available.
let Live2DModelClass:
  | typeof import('pixi-live2d-display-lipsyncpatch/cubism4').Live2DModel
  | null = null

async function getLive2DModel() {
  if (!Live2DModelClass) {
    const mod = await import('pixi-live2d-display-lipsyncpatch/cubism4')
    Live2DModelClass = mod.Live2DModel
  }
  return Live2DModelClass
}

type Live2DModelInstance = InstanceType<
  typeof import('pixi-live2d-display-lipsyncpatch/cubism4').Live2DModel
>

interface Props {
  model: Live2DModelConfig | null
  interactive?: boolean
  transparent?: boolean
  onChange?: (next: { scale: number; xRatio: number; yRatio: number }) => void
}

export function Live2DStage({
  model,
  interactive = true,
  transparent = false,
  onChange
}: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const appRef = React.useRef<PIXI.Application | null>(null)
  const modelRef = React.useRef<Live2DModelInstance | null>(null)
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  // PIXI 应用创建完成标记：模型加载 effect 依赖它，避免 app 未就绪时跳过加载
  const [appReady, setAppReady] = React.useState(false)

  // Tracks user-adjusted position & scale. Falls back to model props when unchanged.
  const userScaleRef = React.useRef<number | null>(null)
  const userXRatioRef = React.useRef<number | null>(null)
  const userYRatioRef = React.useRef<number | null>(null)

  const getCurrentScale = (): number =>
    userScaleRef.current ?? model?.scale ?? 1
  const getCurrentXRatio = (): number =>
    userXRatioRef.current ?? model?.xRatio ?? 0.5
  const getCurrentYRatio = (): number =>
    userYRatioRef.current ?? model?.canvasYRatio ?? 0.6

  // Sync user refs when model prop changes with explicit values — only on initial load.
  React.useEffect(() => {
    if (model && userScaleRef.current === null) {
      userScaleRef.current = model.scale
      userXRatioRef.current = model.xRatio
      userYRatioRef.current = model.canvasYRatio
    }
  }, [model?.modelUrl])

  // Create the pixi application once.
  // Delay creation by one frame so Electron GPU context is fully initialised.
  React.useEffect(() => {
    if (!canvasRef.current || appRef.current) return
    let disposed = false
    let app: PIXI.Application | null = null

    const init = (): void => {
      if (disposed || !canvasRef.current) return
      try {
        app = new PIXI.Application({
          view: canvasRef.current,
          autoStart: true,
          resizeTo: containerRef.current ?? undefined,
          backgroundAlpha: transparent ? 0 : 1,
          backgroundColor: 0x0b0b12,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true
        })
        appRef.current = app
        setAppReady(true)
      } catch (err) {
        console.warn('PIXI init failed, retrying...', err)
        if (!disposed) retryTimer = window.setTimeout(init, 500)
      }
    }

    let retryTimer: number | undefined
    const raf = requestAnimationFrame(init)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      modelRef.current?.destroy()
      modelRef.current = null
      if (app) {
        app.destroy(true, { children: true, texture: true, baseTexture: true })
      }
      appRef.current = null
    }
  }, [transparent])

  // Load / reload the live2d model whenever the url changes or app becomes ready.
  React.useEffect(() => {
    const app = appRef.current
    if (!app || !appReady || !model) return
    let cancelled = false
    let disposeIdleKeeper: () => void = () => {}
    setStatus('loading')
    setErrorMessage(null)
    useLogsStore.getState().appendLocal('info', 'live2d', `开始加载模型: ${model.modelUrl}`)
    ;(async () => {
      try {
        const cubismOk = !!(window as unknown as Record<string, unknown>).Live2DCubismCore
        useLogsStore.getState().appendLocal('info', 'live2d', `CubismCore 可用: ${cubismOk}`)
        if (!cubismOk) {
          throw new Error('Live2DCubismCore 未加载（检查 index.html 的 script 标签）')
        }
        const resp = await fetch(model.modelUrl)
        useLogsStore.getState().appendLocal('info', 'live2d', `model3.json HTTP ${resp.status} ${resp.statusText}`)
        if (!resp.ok) {
          throw new Error(`模型文件 HTTP ${resp.status}: ${resp.statusText}`)
        }
        const json = await resp.json() as { FileReferences?: Record<string, unknown> }
        const fileRefs = Object.keys(json.FileReferences ?? {}).join(', ')
        useLogsStore.getState().appendLocal('info', 'live2d', `model3.json 解析成功, FileReferences: ${fileRefs}`)

        const Live2DModel = await getLive2DModel()
        const loaded = await Live2DModel.from(model.modelUrl, { autoHitTest: interactive, autoFocus: interactive })
        if (cancelled) {
          loaded.destroy()
          return
        }
        if (modelRef.current) {
          app.stage.removeChild(modelRef.current as unknown as PIXI.DisplayObject)
          modelRef.current.destroy()
        }
        modelRef.current = loaded
        app.stage.addChild(loaded as unknown as PIXI.DisplayObject)
        fitModel(
          app,
          loaded,
          getCurrentScale(),
          getCurrentXRatio(),
          getCurrentYRatio()
        )
        registerLive2DModel(loaded as unknown as Parameters<typeof registerLive2DModel>[0])
        setStatus('ready')
        useLogsStore.getState().appendLocal('info', 'live2d', '模型加载成功')
        disposeIdleKeeper = keepIdleAlive(
          loaded as unknown as Parameters<typeof registerLive2DModel>[0]
        )
      } catch (err) {
        console.error('Live2D load failed', err)
        if (!cancelled) {
          const msg = (err as Error).message || 'Live2D 加载失败'
          useLogsStore.getState().appendLocal('error', 'live2d', `模型加载失败: ${msg}`)
          setErrorMessage(msg)
          setStatus('error')
        }
      }
    })()
    return () => {
      cancelled = true
      disposeIdleKeeper()
    }
  }, [model?.modelUrl, model?.canvasYRatio, model?.scale, model?.xRatio, appReady])

  // Resize handling.
  React.useEffect(() => {
    const container = containerRef.current
    const app = appRef.current
    if (!container || !app || !appReady) return
    const observer = new ResizeObserver(() => {
      const currentApp = appRef.current
      const currentContainer = containerRef.current
      if (!currentApp || !currentContainer) return
      currentApp.renderer.resize(
        currentContainer.clientWidth,
        currentContainer.clientHeight
      )
      if (modelRef.current && model) {
        fitModel(
          currentApp,
          modelRef.current,
          getCurrentScale(),
          getCurrentXRatio(),
          getCurrentYRatio()
        )
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [model?.modelUrl, appReady])

  // Lip-sync is handled internally by pixi-live2d-display-lipsyncpatch's
  // model.speak() API, driven from ttsPlayer via the live2dBus.

  // Unregister the model from the global bus on unmount to avoid stale refs.
  React.useEffect(() => {
    return () => {
      registerLive2DModel(null)
    }
  }, [])

  // Drag & wheel: adjust character position and scale with pointer + wheel.
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let isDragging = false
    let dragStartX = 0
    let dragStartY = 0
    let startXRatio = 0
    let startYRatio = 0

    const onPointerDown = (e: PointerEvent): void => {
      if (!modelRef.current) return
      // Only left button (button === 0) triggers dragging.
      if (e.button !== 0) return
      isDragging = true
      dragStartX = e.clientX
      dragStartY = e.clientY
      startXRatio = getCurrentXRatio()
      startYRatio = getCurrentYRatio()
      container.setPointerCapture(e.pointerId)
      e.preventDefault()
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (!isDragging || !container) return
      const rect = container.getBoundingClientRect()
      const dx = (e.clientX - dragStartX) / rect.width
      const dy = (e.clientY - dragStartY) / rect.height
      const nextX = Math.max(0, Math.min(1, startXRatio + dx))
      const nextY = Math.max(0, Math.min(1, startYRatio + dy))
      userXRatioRef.current = nextX
      userYRatioRef.current = nextY
      if (modelRef.current && appRef.current) {
        fitModel(
          appRef.current,
          modelRef.current,
          getCurrentScale(),
          nextX,
          nextY
        )
      }
    }

    const onPointerUp = (e: PointerEvent): void => {
      if (!isDragging) return
      isDragging = false
      try {
        container.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      // 位移小于阈值视为点击：从 click 组随机播一个反应动作
      const moved = Math.max(
        Math.abs(e.clientX - dragStartX),
        Math.abs(e.clientY - dragStartY)
      )
      if (moved < 6 && modelRef.current) {
        startMotionGroup(modelRef.current, 'click')
      }
      onChange?.({
        scale: getCurrentScale(),
        xRatio: getCurrentXRatio(),
        yRatio: getCurrentYRatio()
      })
    }

    const onWheel = (e: WheelEvent): void => {
      if (!modelRef.current || !appRef.current) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.95 : 1.05
      const next = Math.max(0.2, Math.min(3, getCurrentScale() * delta))
      userScaleRef.current = next
      fitModel(
        appRef.current,
        modelRef.current,
        next,
        getCurrentXRatio(),
        getCurrentYRatio()
      )
      // Debounce persistence — emit on next frame.
      requestAnimationFrame(() => {
        onChange?.({
          scale: next,
          xRatio: getCurrentXRatio(),
          yRatio: getCurrentYRatio()
        })
      })
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerUp)
    container.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerUp)
      container.removeEventListener('wheel', onWheel)
    }
  }, [onChange])

  // Mouse tracking -> head / eye params.
  React.useEffect(() => {
    if (!interactive) return
    const container = containerRef.current
    if (!container) return
    const handler = (event: MouseEvent | PointerEvent) => {
      const currentModel = modelRef.current
      if (!currentModel) return
      const rect = container.getBoundingClientRect()
      const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1
      applyHeadTracking(currentModel, nx, ny, model?.paramMapping)
    }
    container.addEventListener('pointermove', handler)
    return () => container.removeEventListener('pointermove', handler)
  }, [interactive, model?.paramMapping])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden select-none"
      style={{
        background: transparent ? 'transparent' : undefined,
        cursor: status === 'ready' ? 'grab' : undefined
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {status === 'ready' && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/30 px-2 py-0.5 text-[10px] text-white/60">
          拖拽移动 · 滚轮缩放
        </div>
      )}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <span className="text-xs">正在加载 Live2D 模型...</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-destructive">
          <AlertCircle className="size-6" />
          <span className="text-xs">{errorMessage}</span>
        </div>
      )}
      {!model && status === 'idle' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          未检测到默认模型
        </div>
      )}
    </div>
  )
}

function fitModel(
  app: PIXI.Application,
  model: Live2DModelInstance,
  scale: number,
  xRatio: number,
  yRatio: number
): void {
  const { width, height } = app.screen
  const naturalHeight = model.getLocalBounds().height
  // Base scale = fill 92% of canvas height, then apply user scale multiplier.
  const baseScale = naturalHeight > 0 ? (height * 0.92) / naturalHeight : 1
  const finalScale = baseScale * scale
  model.scale.set(finalScale)
  model.anchor.set(0.5, 0.5)
  model.x = width * xRatio
  model.y = height * yRatio
}

/**
 * 从指定动作组随机播一个动作，FORCE 优先级（可打断 idle）。动作文件已改为
 * 单次播放（Loop=false），播完由 keepIdleAlive 的 motionFinish 钩子接回待机。
 */
function startMotionGroup(model: Live2DModelInstance, group: string): void {
  const mm = (
    model.internalModel as unknown as {
      motionManager?: {
        startRandomMotion?: (group: string, priority: number) => Promise<boolean>
      }
    }
  ).motionManager
  try {
    mm?.startRandomMotion?.(group, 3)?.catch(() => {})
  } catch {
    // ignore
  }
}

/**
 * idle 保活巡检：库的动作续播链路在动作播完后偶发断裂（不再重新请求 idle），
 * 表现为模型整体静止、只剩鼠标跟踪。每 2 秒检查一次，停了就以 FORCE 优先级
 * 重启 idle 组。idle 动作文件里的头部/眼球曲线已剥离（b_idle 去掉了 8 条），
 * 头部参数完全由鼠标跟踪接管，动作只负责身体和头发的摆动，两者互不冲突。
 */
function keepIdleAlive(model: Parameters<typeof registerLive2DModel>[0]): () => void {
  const mm = (
    model as { internalModel?: { motionManager?: Record<string, unknown> } }
  ).internalModel?.motionManager as
    | {
        isFinished?: () => boolean
        startRandomMotion?: (group: string, priority: number) => Promise<boolean>
        on?: (event: string, cb: (...args: unknown[]) => void) => void
      }
    | undefined
  // 动作加载失败会被库静默拉黑（槽位存 null，永不再试），必须显式暴露到日志
  mm?.on?.('motionLoadError', (...args) => {
    useLogsStore.getState().appendLocal(
      'error',
      'live2d',
      `动作加载失败（该动作已被拉黑，不会再重试）: ${String(args[0])} [${String(args[1])}]`,
      String(args[2] ?? '')
    )
  })
  const isFinished = mm?.isFinished
  const startRandomMotion = mm?.startRandomMotion
  if (!isFinished || !startRandomMotion) return () => {}
  // 单次动作（点击反应等）播完的瞬间立刻接回 idle，不等 2 秒轮询
  mm?.on?.('motionFinish', () => {
    try {
      void startRandomMotion('Idle', 3)
    } catch {
      // ignore
    }
  })
  let stopped = false
  const timer = window.setInterval(() => {
    if (stopped) return
    try {
      if (!isFinished()) return
      void startRandomMotion('Idle', 3).then(
        (ok) => {
          if (ok && !stopped) {
            useLogsStore.getState().appendLocal('info', 'live2d', 'idle 动作已停止，自动重启')
          }
        },
        () => {}
      )
    } catch {
      stopped = true
    }
  }, 2000)
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}

function applyHeadTracking(
  model: Live2DModelInstance,
  nx: number,
  ny: number,
  mapping?: Live2DModelConfig['paramMapping']
): void {
  const internal = (model.internalModel as unknown as {
    coreModel: {
      setParameterValueById?: (id: string, value: number) => void
    }
  }).coreModel
  if (!internal?.setParameterValueById) return
  const clamp = (v: number) => Math.max(-1, Math.min(1, v))
  const cx = clamp(nx)
  const cy = clamp(ny)
  const p = mapping ?? {
    angleX: 'ParamAngleX',
    angleY: 'ParamAngleY',
    angleZ: 'ParamAngleZ',
    bodyAngleX: 'ParamBodyAngleX',
    eyeBallX: 'ParamEyeBallX',
    eyeBallY: 'ParamEyeBallY'
  }
  if (p.angleX) internal.setParameterValueById(p.angleX, cx * 30)
  if (p.angleY) internal.setParameterValueById(p.angleY, -cy * 30)
  if (p.angleZ) internal.setParameterValueById(p.angleZ, cx * 10)
  if (p.bodyAngleX) internal.setParameterValueById(p.bodyAngleX, cx * 10)
  if (p.eyeBallX) internal.setParameterValueById(p.eyeBallX, cx)
  if (p.eyeBallY) internal.setParameterValueById(p.eyeBallY, -cy)
}
