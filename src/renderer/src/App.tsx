import * as React from 'react'
import { X } from 'lucide-react'
import { AppBar } from '@/components/nav/AppBar'
import { GalgameChatPanel } from '@/components/chat/GalgameChatPanel'
import { ChatWorkspace } from '@/components/chat/ChatWorkspace'
import { Live2DStage } from '@/components/live2d/Live2DStage'
import { SpriteStage } from '@/components/sprite/SpriteStage'
import { SpineStage } from '@/components/spine/SpineStage'
import { SettingsCenter } from '@/components/settings/SettingsCenter'
import { LogsPanel } from '@/components/logs/LogsPanel'
import { MarketPage } from '@/components/market/MarketPage'
import { HomePage } from '@/components/home/HomePage'
import { RoleDashboard } from '@/components/dashboard/RoleDashboard'
import type { AppConfig, Live2DModelConfig } from '@shared/types'
import { startPipeline } from '@/features/pipeline'
import { useRoleStore } from '@/features/role/roleStore'
import { startLogsBridge } from '@/features/logs/logsStore'
import { mergeSavedTransform } from '@/features/live2d/modelTransform'
import { useStartupStore, maybeGreet } from '@/features/startup/startupStore'
import { useASRStore } from '@/features/asr/asrStore'
import { shouldShowMainStage } from '@shared/stagePolicy'
import { isRoleRunning } from '@shared/role/runtime'
import { useRoleRuntimeStore } from '@/features/role/roleRuntimeStore'
import { setEyesClosed } from '@/features/live2d/live2dBus'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { getErrorMessage } from '@shared/errors'
import type { AppViewName } from '@shared/uiState'
import { useUIStateStore } from '@/features/uiState/uiStateStore'

const VIEW_ORDER: AppViewName[] = ['home', 'chat', 'market', 'settings', 'logs']

export default function App() {
  const [config, setConfig] = React.useState<AppConfig | null>(null)
  const [model, setModel] = React.useState<Live2DModelConfig | null>(null)
  const [mateOpen, setMateOpen] = React.useState(false)
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null)
  const [view, setView] = React.useState<AppViewName>('home')
  const [actionError, setActionError] = React.useState('')
  const uiStateLoaded = useUIStateStore((s) => s.loaded)
  const uiRestored = React.useRef(false)
  const roles = useRoleStore((s) => s.list)
  const bootSteps = useStartupStore((s) => s.steps)
  const loadRoles = useRoleStore((s) => s.loadRoles)
  const activeId = useRoleStore((s) => s.activeId)
  const activeCard = useRoleStore((s) => s.list.find((card) => card.id === s.activeId))
  const outfits = useRoleStore((s) => s.outfits)
  const runningById = useRoleRuntimeStore((s) => s.byId)
  const activeRunning = isRoleRunning(runningById, activeId)

  React.useEffect(() => {
    void useUIStateStore.getState().load()
  }, [])

  React.useEffect(() => {
    if (!uiStateLoaded || uiRestored.current) return
    uiRestored.current = true
    const saved = useUIStateStore.getState().state
    if (saved.view) setView(saved.view)
    if (saved.mate?.open) {
      void window.opengal.mate.open().then((res) => {
        if (res.success) setMateOpen(true)
      }).catch(() => {})
    }
  }, [uiStateLoaded])

  React.useEffect(() => {
    if (!uiRestored.current) return
    useUIStateStore.getState().patch({ view })
  }, [view])

  React.useEffect(() => {
    if (activeCard?.performance.mode === 'sprite') setAvatarUrl(activeCard.spriteFrames?.idle ?? null)
  }, [activeCard])

  React.useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      const idx = VIEW_ORDER.indexOf(view)
      if (idx < 0) return
      if (e.button === 3) {
        const prev = VIEW_ORDER[idx - 1]
        if (!prev) return
        e.preventDefault()
        setView(prev)
      } else if (e.button === 4) {
        const next = VIEW_ORDER[idx + 1]
        if (!next) return
        e.preventDefault()
        setView(next)
      }
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [view])

  React.useEffect(() => {
    const toSettings = () => setView('settings')
    const toLogs = () => setView('logs')
    window.addEventListener('opengal:open-settings', toSettings)
    window.addEventListener('opengal:open-logs', toLogs)
    return () => {
      window.removeEventListener('opengal:open-settings', toSettings)
      window.removeEventListener('opengal:open-logs', toLogs)
    }
  }, [])

  React.useEffect(() => {
    const handle = startPipeline()
    return () => handle.dispose()
  }, [])

  React.useEffect(() => startLogsBridge(), [])

  React.useEffect(() => {
    void (async () => {
      const cfg = await window.opengal.config.get()
      if (cfg.success && cfg.data) {
        setConfig(cfg.data)
        useRoleRuntimeStore.getState().hydrate(cfg.data.runningRoles)
        await useASRStore.getState().applySettings(cfg.data.asr)
        if (!cfg.data.showLive2D) useStartupStore.getState().reportLive2d('skipped')
        await loadRoles(cfg.data.activeRoleId)
        const active = useRoleStore.getState().getActive()
        if (active) {
          const fromCard = await window.opengal.model.resolveFromCard(active.id)
          if (fromCard.success && fromCard.data) {
            setModel(mergeSavedTransform(fromCard.data, cfg.data.model))
            return
          }
        }
        if (cfg.data.model?.modelUrl) {
          setModel(cfg.data.model)
          return
        }
        const resolved = await window.opengal.model.resolveDefault()
        if (resolved.success && resolved.data) {
          setModel(resolved.data)
        }
      }
    })()
  }, [loadRoles])

  React.useEffect(() => {
    window.opengal.mate?.emitRuntime?.({
      runningRoles: runningById,
      activeRoleId: activeId,
    })
  }, [runningById, activeId])

  React.useEffect(
    () =>
      window.opengal.mate?.onUpdate?.((payload) => {
        if (payload.type === 'avatar') setAvatarUrl(payload.dataUrl)
      }),
    []
  )

  React.useEffect(() => {
    setEyesClosed(!activeRunning)
    if (activeRunning) {
      if (useStartupStore.getState().phase !== 'awake') useStartupStore.getState().beginBoot()
      else void maybeGreet()
      return
    }
    pipelineBus.emit('pipeline:abort', undefined)
    void window.opengal.tts.cancel()
  }, [activeId, activeRunning])

  React.useEffect(() => {
    if (!activeId) return
    void (async () => {
      const fromCard = await window.opengal.model.resolveFromCard(activeId)
      if (fromCard.success && fromCard.data) {
        const currentCfg = (await window.opengal.config.get()).data
        setModel(mergeSavedTransform(fromCard.data, currentCfg?.model))
      } else {
        const cfg = await window.opengal.config.get()
        if (cfg.success && cfg.data?.model?.modelUrl) {
          setModel(cfg.data.model)
        }
      }
    })()
  }, [activeId])

  async function saveConfig(patch: Partial<AppConfig>): Promise<void> {
    const res = await window.opengal.config.set(patch)
    if (!res.success || !res.data) throw new Error(res.error || 'save failed')
    setConfig(res.data)
    if (patch.asr) {
      try { await useASRStore.getState().applySettings(res.data.asr) }
      catch (error) { throw new Error(`设置已保存，但识别重载失败：${getErrorMessage(error)}`) }
    }
    if (patch.model && model) {
      setModel({
        ...model,
        scale: patch.model.scale ?? model.scale,
        xRatio: patch.model.xRatio ?? model.xRatio,
        canvasYRatio: patch.model.canvasYRatio ?? model.canvasYRatio
      })
    }
  }

  async function setRunningFor(roleId: string): Promise<void> {
    const nextRunning = !isRoleRunning(
      useRoleRuntimeStore.getState().byId,
      roleId,
    )
    const runningRoles = {
      ...useRoleRuntimeStore.getState().byId,
      [roleId]: nextRunning,
    }
    try {
      await saveConfig({ runningRoles })
      useRoleRuntimeStore.getState().setRunning(roleId, nextRunning)
      setActionError('')
    } catch {
      setActionError('运行状态保存失败，请重试')
    }
  }

  async function openRole(roleId: string): Promise<void> {
    if (roleId !== activeId) await useRoleStore.getState().setActive(roleId)
    setView('chat')
  }

  async function toggleMate(): Promise<void> {
    if (mateOpen) {
      await window.opengal.mate.close()
      setMateOpen(false)
      useUIStateStore.getState().patch({ mate: { open: false } })
    } else {
      const res = await window.opengal.mate.open()
      if (res.success) {
        setMateOpen(true)
        useUIStateStore.getState().patch({ mate: { open: true } })
      }
    }
  }

  async function toggleLive2D(): Promise<void> {
    const next = !(config?.showLive2D ?? true)
    try {
      await saveConfig({ showLive2D: next })
      setActionError('')
    } catch (err) {
      setActionError(`显示设置保存失败：${getErrorMessage(err)}`)
    }
  }

  const handleModelChange = React.useCallback(
    (next: { scale: number; xRatio: number; yRatio: number }) => {
      if (!model) return
      saveConfig({
        model: {
          ...model,
          scale: next.scale,
          xRatio: next.xRatio,
          canvasYRatio: next.yRatio
        }
      }).catch((err: Error) => {
        setActionError(`模型设置保存失败：${err.message}`)
      })
    },
    [model]
  )

  const handleSnapshot = React.useCallback((url: string) => setAvatarUrl(url), [])
  const activeOutfit = React.useMemo(() => {
    const entries = activeCard?.outfitEntries
    if (!activeCard || !entries?.length) return null
    const wanted = outfits[activeCard.id] ?? activeCard.performance.defaultOutfit
    return entries.find((outfit) => outfit.id === wanted) ?? entries[0] ?? null
  }, [activeCard, outfits])

  const live2dLayer = shouldShowMainStage(config?.showLive2D ?? true, mateOpen) ? (
    activeOutfit?.mode === 'spine' && activeOutfit.spineSkelUrl && activeOutfit.spineAtlasUrl ? (
      <SpineStage
        skelUrl={activeOutfit.spineSkelUrl}
        atlasUrl={activeOutfit.spineAtlasUrl}
        scale={activeOutfit.spine?.scale}
        sleeping={!activeRunning}
      />
    ) : activeOutfit?.spriteFrames ? (
      <SpriteStage frames={activeOutfit.spriteFrames} roleId={activeCard?.id ?? ''} sleeping={!activeRunning} />
    ) : activeCard?.performance.mode === 'sprite' && activeCard.spriteFrames ? (
      <SpriteStage frames={activeCard.spriteFrames} roleId={activeCard.id} sleeping={!activeRunning} />
    ) : (
      <Live2DStage
        model={model}
        sleeping={!activeRunning}
        onChange={handleModelChange}
        onSnapshot={handleSnapshot}
      />
    )
  ) : (
    <div className="h-full w-full bg-background" />
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AppBar
        view={view}
        onNavigate={setView}
        avatarUrl={avatarUrl}
        onSelectRole={(id) => void openRole(id)}
        mateOpen={mateOpen}
        onToggleMate={() => void toggleMate()}
        showLive2D={config?.showLive2D ?? true}
        onToggleLive2D={() => void toggleLive2D()}
      />
      {actionError && (
        <div role="alert" className="shrink-0 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {actionError}
        </div>
      )}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
          {view === 'home' && (
            <HomePage
              roles={roles}
              activeId={activeId}
              runningById={runningById}
              steps={bootSteps}
              onOpenRole={(id) => void openRole(id)}
              onToggleRunning={setRunningFor}
            />
          )}

          <div className={view === 'chat' ? 'h-full min-w-0 flex-1' : 'hidden'}>
            <ChatWorkspace
              chat={activeCard ? (
                <RoleDashboard
                  role={activeCard}
                  running={activeRunning}
                  onToggleRunning={() => void setRunningFor(activeCard.id)}
                />
              ) : <div className="p-6 text-sm text-muted-foreground">请选择一个角色</div>}
              stage={(
                <div className="relative h-full min-w-0 overflow-hidden">
                  <div className="absolute inset-0">{live2dLayer}</div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 top-1/4 z-10 bg-gradient-to-t from-background via-background/80 to-transparent" />
                  <div className="absolute inset-0 z-20">
                    <GalgameChatPanel />
                  </div>
                </div>
              )}
            />
          </div>

          {view === 'market' && <MarketPage />}

          {view === 'settings' && (
            <div className="flex h-full w-full flex-col bg-background">
              <div className="flex h-12 shrink-0 items-center border-b px-4">
                <span className="text-sm font-semibold">设置</span>
                <button
                  type="button"
                  title="关闭"
                  className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setView('chat')}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                {config && <SettingsCenter config={config} model={model} onSave={saveConfig} />}
              </div>
            </div>
          )}

          {view === 'logs' && <LogsPanel onClose={() => setView('chat')} />}
      </main>
    </div>
  )
}
