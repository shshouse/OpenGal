import * as React from 'react'
import { LayoutGrid, MessageSquareText, Moon, Pause, Play, Trash2, X } from 'lucide-react'
import type { Live2DModelConfig, RoleMode } from '@shared/types'
import { isRoleRunning } from '@shared/role/runtime'
import { Button } from '@/components/ui/button'
import { ChatComposerBar } from '@/components/chat/ChatComposerBar'
import { ChatThread } from '@/components/chat/ChatThread'
import { RoleStageCanvas } from '@/components/stage/RoleStageCanvas'
import { cn } from '@/lib/utils'
import { useASRStore } from '@/features/asr/asrStore'
import { useChatStore } from '@/features/chat/chatStore'
import { applyEmotion, playMotionGroup, setEyesClosed } from '@/features/live2d/live2dBus'
import { mergeSavedTransform } from '@/features/live2d/modelTransform'
import { startLogsBridge } from '@/features/logs/logsStore'
import { startPipeline } from '@/features/pipeline'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { useRoleRuntimeStore } from '@/features/role/roleRuntimeStore'
import { useRoleStore } from '@/features/role/roleStore'
import { useSpokenLineStore } from '@/features/speech/spokenLine'
import { displaySubtitle, subtitleForSegment, useSubtitleStore } from '@/features/speech/subtitles'
import { maybeGreet, useStartupStore } from '@/features/startup/startupStore'

const DRAG_THRESHOLD_PX = 6

export default function MateView(): React.JSX.Element {
  const [model, setModel] = React.useState<Live2DModelConfig | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [subtitleLine, setSubtitleLine] = React.useState('')
  const [controlsHovered, setControlsHovered] = React.useState(false)
  const [liveActivity, setLiveActivity] = React.useState('')
  const [lifePaused, setLifePaused] = React.useState(true)
  const lastMoodRef = React.useRef<string>('')
  const dragRef = React.useRef<{ x: number; y: number; dragging: boolean } | null>(null)

  const roles = useRoleStore((s) => s.list)
  const activeId = useRoleStore((s) => s.activeId)
  const loadRoles = useRoleStore((s) => s.loadRoles)
  const activeRole = roles.find((card) => card.id === activeId) ?? null

  const runningById = useRoleRuntimeStore((s) => s.byId)
  const running = isRoleRunning(runningById, activeId)
  const sleeping = !running
  const streamingSegments = useChatStore((s) => s.streamingSegments)
  const spoken = useSpokenLineStore((s) => s)
  useSubtitleStore((s) => s.records)
  useSubtitleStore((s) => s.preferences)

  React.useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    return () => {
      window.opengal.mate.setIgnoreMouse(false)
    }
  }, [])

  React.useEffect(() => {
    const handle = startPipeline()
    const stopLogs = startLogsBridge()
    return () => {
      stopLogs()
      handle.dispose()
    }
  }, [])

  React.useEffect(
    () =>
      window.opengal.role.onOutfitChanged((change) => {
        void useRoleStore.getState().setOutfit(change.roleId, change.outfitId)
      }),
    [],
  )

  React.useEffect(() => {
    const syncItem = (item?: { lifePaused: boolean; state: { mood: string; currentActivity: string } }): void => {
      if (!item) return
      setLifePaused(item.lifePaused)
      setLiveActivity(item.state.currentActivity || '')
      if (item.state.mood && item.state.mood !== lastMoodRef.current) {
        lastMoodRef.current = item.state.mood
        applyEmotion(item.state.mood)
      }
    }
    void window.opengal.runtime?.snapshot?.().then((res) => {
      if (res.success && res.data && activeId) syncItem(res.data.roles[activeId])
    })
    const off = window.opengal.runtime?.onChanged?.((snap) => {
      if (activeId) syncItem(snap.roles[activeId])
    })
    return () => {
      off?.()
    }
  }, [activeId])

  React.useEffect(() => {
    void (async () => {
      const [cfgRes, snapRes] = await Promise.all([
        window.opengal.config.get(),
        window.opengal.runtime.snapshot().catch(() => null),
      ])
      if (snapRes?.success && snapRes.data) {
        const map: Record<string, boolean> = {}
        for (const [id, item] of Object.entries(snapRes.data.roles)) {
          map[id] = item.running
        }
        useRoleRuntimeStore.getState().hydrate(map)
      } else if (cfgRes.success && cfgRes.data) {
        useRoleRuntimeStore.getState().hydrate(cfgRes.data.runningRoles)
      }
      if (cfgRes.success && cfgRes.data) {
        await useASRStore.getState().applySettings(cfgRes.data.asr).catch(() => {})
        await loadRoles(snapRes?.data?.focusedRoleId ?? cfgRes.data.activeRoleId)
      }
    })()
  }, [loadRoles])

  React.useEffect(() => {
    if (!activeId) return
    void (async () => {
      const cfg = (await window.opengal.config.get()).data
      const fromCard = await window.opengal.model.resolveFromCard(activeId)
      if (fromCard.success && fromCard.data) {
        setModel(mergeSavedTransform(fromCard.data, cfg?.model))
        return
      }
      if (cfg?.model?.modelUrl) {
        setModel(cfg.model)
        return
      }
      const fallback = await window.opengal.model.resolveDefault()
      if (fallback.success && fallback.data) setModel(fallback.data)
    })()
  }, [activeId])

  React.useEffect(() => {
    setEyesClosed(!running)
    if (running) {
      if (useStartupStore.getState().phase !== 'awake') useStartupStore.getState().beginBoot()
      else void maybeGreet()
      return
    }
    pipelineBus.emit('pipeline:abort', undefined)
    void window.opengal.tts.cancel()
  }, [activeId, running])

  // 台词气泡仅展示角色自身台词，绝不混入用户输入
  React.useEffect(() => {
    if (!activeId) {
      setSubtitleLine('')
      return
    }
    const streamingText = streamingSegments.map((s) => s.item.text).join('').trim()
    if (spoken.mode === 'speech' && spoken.roleId === activeId && spoken.text) {
      const line = subtitleForSegment(activeId, spoken.segmentId, spoken.text).trim()
      if (line) {
        setSubtitleLine(line)
        return
      }
    }
    if (streamingText) {
      setSubtitleLine(displaySubtitle(activeId, streamingText))
    }
  }, [activeId, spoken.mode, spoken.roleId, spoken.segmentId, spoken.text, streamingSegments])

  React.useEffect(() => {
    if (!subtitleLine || streamingSegments.length > 0) return
    const timer = window.setTimeout(() => setSubtitleLine(''), 7000)
    return () => window.clearTimeout(timer)
  }, [subtitleLine, streamingSegments.length])

  async function toggleDrawer(): Promise<void> {
    const next = !drawerOpen
    setDrawerOpen(next)
    await window.opengal.mate.setDrawerOpen(next).catch(() => {})
  }

  async function openStudioWindow(): Promise<void> {
    if (drawerOpen) {
      setDrawerOpen(false)
      await window.opengal.mate.setDrawerOpen(false).catch(() => {})
    }
    await window.opengal.mate.openStudio()
    await window.opengal.mate.close()
  }

  async function toggleRunning(): Promise<void> {
    if (!activeRole) return
    const next = !running
    const res = await window.opengal.runtime.setRunning(activeRole.id, next)
    if (res.success && res.data) {
      const map: Record<string, boolean> = {}
      for (const [id, item] of Object.entries(res.data.roles)) map[id] = item.running
      useRoleRuntimeStore.getState().hydrate(map)
    }
  }

  async function toggleMode(): Promise<void> {
    if (!activeRole) return
    const nextMode: RoleMode = activeRole.mode === 'life' ? 'agent' : 'life'
    await window.opengal.runtime.setMode(activeRole.id, nextMode)
    await loadRoles(activeRole.id)
  }

  const onStagePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    dragRef.current = { x: e.screenX, y: e.screenY, dragging: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    void window.opengal.mate.dragStart()
  }

  const onStagePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
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
    void window.opengal.mate.dragMove()
  }

  const onStagePointerEnd = (e: React.PointerEvent<HTMLDivElement>): void => {
    const s = dragRef.current
    dragRef.current = null
    if (s && !s.dragging && e.type === 'pointerup') playMotionGroup('click')
  }

  const roleLabel = activeRole?.displayName ?? activeRole?.name ?? '未选择角色'
  const currentMode = activeRole?.mode ?? 'agent'

  return (
    <div
      className="flex h-full w-full select-none gap-2 p-2"
      style={{ background: 'transparent' }}
      onMouseEnter={() => {
        setControlsHovered(true)
        window.opengal.mate.setIgnoreMouse(false)
      }}
      onMouseLeave={() => {
        setControlsHovered(false)
        if (!drawerOpen) window.opengal.mate.setIgnoreMouse(true)
      }}
    >
      {drawerOpen ? (
        <aside className="flex h-full w-[332px] shrink-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground edge-float">
          <header className="flex h-11 shrink-0 items-center justify-between border-b px-3">
            <span className="truncate text-xs font-medium">{roleLabel} · 对话记录</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => useChatStore.getState().clear()}
                title="清空当前对话"
                aria-label="清空当前对话"
                className="size-7 text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void toggleDrawer()}
                title="收起对话记录"
                aria-label="收起对话记录"
                className="size-7 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </header>
          <div className="min-h-0 flex-1 select-text">
            <ChatThread roleLabel={roleLabel} roleColor={activeRole?.color} showAvatar={false} />
          </div>
        </aside>
      ) : null}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div
          className={cn(
            'z-20 flex items-center justify-between gap-1.5 rounded-xl border bg-popover/95 px-2.5 py-1.5 text-popover-foreground transition-opacity edge-float',
            controlsHovered || drawerOpen || !activeRole ? 'opacity-100' : 'opacity-0 focus-within:opacity-100',
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {roles.length > 1 ? (
              <select
                value={activeId ?? ''}
                onChange={(e) => {
                  const id = e.target.value
                  if (id) {
                    void useRoleStore.getState().setActive(id)
                    void window.opengal.runtime.focus(id)
                  }
                }}
                aria-label="切换当前角色"
                className="max-w-[112px] truncate rounded-md border bg-background px-1.5 py-1 text-xs text-foreground"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.displayName ?? r.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="max-w-[112px] truncate px-1 text-xs font-medium">{roleLabel}</span>
            )}

            {activeRole ? (
              <button
                type="button"
                onClick={() => void toggleMode()}
                title="切换 Agent 与 Life 模式"
                className={cn(
                  'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                  currentMode === 'life'
                    ? 'border-brand/40 bg-brand/15 text-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground',
                )}
              >
                {currentMode === 'life' ? 'Life' : 'Agent'}
              </button>
            ) : null}

            {activeRole && currentMode === 'life' && running ? (
              <button
                type="button"
                onClick={() => void window.opengal.runtime.setLifePaused(activeRole.id, !lifePaused)}
                title={lifePaused ? '开始自主生活循环' : '暂停自主生活循环'}
                className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                {lifePaused ? <Play className="size-3" /> : <Pause className="size-3" />}
                <span>{lifePaused ? '开始' : '暂停'}</span>
              </button>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {activeRole ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void toggleRunning()}
                title={running ? '让角色休息' : '唤醒角色'}
                aria-label={running ? '让角色休息' : '唤醒角色'}
                className="size-7"
              >
                {running ? <Moon className="size-3.5" /> : <Play className="size-3.5" />}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void toggleDrawer()}
              aria-pressed={drawerOpen}
              title="侧栏展开对话记录"
              aria-label="侧栏展开对话记录"
              className={cn('size-7', drawerOpen && 'bg-accent text-accent-foreground')}
            >
              <MessageSquareText className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void openStudioWindow()}
              className="h-7 px-2 text-xs"
            >
              <LayoutGrid className="size-3.5" />
              工作台
            </Button>
          </div>
        </div>

        <div
          className="relative min-h-0 flex-1"
          style={{ cursor: 'grab' }}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerEnd}
          onPointerCancel={onStagePointerEnd}
        >
          <RoleStageCanvas
            role={activeRole}
            model={model}
            sleeping={sleeping}
            outfitId={activeRole?.activeOutfitId}
            transparent
            mate
            onSnapshot={(dataUrl) => window.opengal.mate.emitAvatar(dataUrl)}
          />

          {controlsHovered && running && liveActivity ? (
            <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex justify-center">
              <span className="max-w-full truncate rounded-full border bg-popover/90 px-2.5 py-0.5 text-xs text-muted-foreground edge-float">
                {liveActivity}
              </span>
            </div>
          ) : null}

          {subtitleLine ? (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10">
              <div className="rounded-xl border bg-popover/95 px-3 py-2 text-xs leading-relaxed text-popover-foreground edge-float">
                <p className="line-clamp-4 whitespace-pre-wrap break-words">{subtitleLine}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="z-20 shrink-0 pt-1">
          <ChatComposerBar compact />
        </div>
      </div>
    </div>
  )
}
