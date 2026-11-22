import * as React from 'react'
import { MonitorUp, Moon, Pause, Play, Plus, Trash2, X } from 'lucide-react'
import { getErrorMessage } from '@shared/app/errors'
import { isRoleRunning } from '@shared/role/runtime'
import type { AppConfig, Live2DModelConfig, RoleMode } from '@shared/types'
import type { AppViewName } from '@shared/ui/uiState'
import { Button } from '@/components/ui/button'
import { ChatComposerBar } from '@/components/chat/ChatComposerBar'
import { ChatThread } from '@/components/chat/ChatThread'
import { ContextUsageIndicator } from '@/components/chat/ContextUsageIndicator'
import { LogsPanel } from '@/components/logs/LogsPanel'
import { RoleCreatorPanel } from '@/components/role/RoleCreatorPanel'
import { NavRail } from '@/components/shell/NavRail'
import { WindowBar } from '@/components/shell/WindowBar'
import { RoleStageCanvas } from '@/components/stage/RoleStageCanvas'
import { RoleWorkshopPanel } from '@/components/workshop/RoleWorkshopPanel'
import { cropImageHead } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { useASRStore } from '@/features/asr/asrStore'
import { useChatStore } from '@/features/chat/chatStore'
import { applyEmotion, setEyesClosed } from '@/features/live2d/live2dBus'
import { mergeSavedTransform } from '@/features/live2d/modelTransform'
import { startLogsBridge } from '@/features/logs/logsStore'
import { startPipeline } from '@/features/pipeline'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import { useRoleRuntimeStore } from '@/features/role/roleRuntimeStore'
import { useRoleStore } from '@/features/role/roleStore'
import { maybeGreet, useStartupStore } from '@/features/startup/startupStore'
import { useUIStateStore } from '@/features/uiState/uiStateStore'

const MarketPage = React.lazy(() =>
  import('@/components/market/MarketPage').then((m) => ({ default: m.MarketPage })),
)
const SettingsCenter = React.lazy(() =>
  import('@/components/settings/SettingsCenter').then((m) => ({ default: m.SettingsCenter })),
)
const RoleStudio = React.lazy(() =>
  import('@/components/role/RoleStudio').then((m) => ({ default: m.RoleStudio })),
)

export default function App(): React.JSX.Element {
  const [config, setConfig] = React.useState<AppConfig | null>(null)
  const [model, setModel] = React.useState<Live2DModelConfig | null>(null)
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null)
  const [workshopPreviewUrl, setWorkshopPreviewUrl] = React.useState<string | null>(null)
  const [view, setView] = React.useState<AppViewName>('chat')
  const [actionError, setActionError] = React.useState('')
  const [liveActivity, setLiveActivity] = React.useState('')
  const [avatarSource, setAvatarSource] = React.useState<{ roleId: string; url: string } | null>(null)
  const [avatarCaptureRequest, setAvatarCaptureRequest] = React.useState(0)
  const [lifePaused, setLifePaused] = React.useState(true)
  const lastMoodRef = React.useRef('')

  const uiStateLoaded = useUIStateStore((s) => s.loaded)
  const uiRestored = React.useRef(false)
  const roles = useRoleStore((s) => s.list)
  const loadRoles = useRoleStore((s) => s.loadRoles)
  const activeId = useRoleStore((s) => s.activeId)
  const activeCard = useRoleStore((s) => s.list.find((card) => card.id === s.activeId)) ?? null
  const runningById = useRoleRuntimeStore((s) => s.byId)
  const activeRunning = isRoleRunning(runningById, activeId)

  React.useEffect(() => {
    void useUIStateStore.getState().load?.()
  }, [])

  React.useEffect(() => {
    if (!uiStateLoaded || uiRestored.current) return
    uiRestored.current = true
    const saved = useUIStateStore.getState().state
    if (saved.view) {
      setView(saved.view === 'home' ? 'chat' : saved.view)
    }
  }, [uiStateLoaded])

  React.useEffect(() => {
    if (!uiRestored.current) return
    useUIStateStore.getState().patch?.({ view })
  }, [view])

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
      window.opengal.role?.onOutfitChanged?.((change) => {
        void useRoleStore.getState().setOutfit(change.roleId, change.outfitId)
      }) ?? (() => {}),
    [],
  )

  React.useEffect(() => {
    void (async () => {
      if (!window.opengal.config?.get) return
      const [cfg, snap] = await Promise.all([
        window.opengal.config.get(),
        window.opengal.runtime?.snapshot?.().catch(() => null) ?? Promise.resolve(null),
      ])
      if (!cfg.success || !cfg.data) return
      setConfig(cfg.data)
      if (snap?.success && snap.data) {
        useRoleRuntimeStore.getState().hydrateSnapshot(snap.data)
      } else {
        useRoleRuntimeStore.getState().hydrate(cfg.data.runningRoles)
      }
      await useASRStore.getState().applySettings(cfg.data.asr).catch(() => {})
      if (!cfg.data.showLive2D) useStartupStore.getState().reportLive2d('skipped')
      await loadRoles(snap?.data?.focusedRoleId ?? cfg.data.activeRoleId)

      const loadedList = useRoleStore.getState().list
      if (loadedList.length === 0) {
        setView('create')
        return
      }

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
      if (resolved.success && resolved.data) setModel(resolved.data)
    })()
  }, [loadRoles])

  React.useEffect(() => {
    if (!activeId) return
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
      if (res.success && res.data) syncItem(res.data.roles[activeId])
    })
    const off = window.opengal.runtime?.onChanged?.((snap) => {
      syncItem(snap.roles[activeId])
    })
    return () => {
      off?.()
    }
  }, [activeId])

  React.useEffect(() => {
    setEyesClosed(!activeRunning)
    if (activeRunning) {
      if (useStartupStore.getState().phase !== 'awake') useStartupStore.getState().beginBoot()
      else void maybeGreet()
      return
    }
    pipelineBus.emit('pipeline:abort', undefined)
    void window.opengal.tts?.cancel?.()
  }, [activeId, activeRunning])

  React.useEffect(() => {
    if (!activeId || !window.opengal.model?.resolveFromCard) return
    void (async () => {
      const fromCard = await window.opengal.model.resolveFromCard(activeId)
      if (fromCard.success && fromCard.data) {
        const currentCfg = (await window.opengal.config.get()).data
        setModel(mergeSavedTransform(fromCard.data, currentCfg?.model))
      } else {
        const cfg = await window.opengal.config.get()
        if (cfg.data?.model?.modelUrl) setModel(cfg.data.model)
      }
    })()
  }, [activeId])

  const requestAvatarSource = React.useCallback(() => setAvatarCaptureRequest((value) => value + 1), [])

  const spriteIdleUrl = activeCard?.spriteFrames?.idle ?? null
  React.useEffect(() => {
    setAvatarSource(null)
  }, [activeId])
  React.useEffect(() => {
    if (!spriteIdleUrl) {
      setAvatarUrl(null)
      return
    }
    let cancelled = false
    setAvatarUrl(activeCard?.performance.avatar ? spriteIdleUrl : null)
    if (activeCard?.performance.avatar) return () => { cancelled = true }
    void cropImageHead(spriteIdleUrl).then((cropped) => {
      if (!cancelled && cropped) setAvatarUrl(cropped)
    })
    return () => {
      cancelled = true
    }
  }, [activeCard?.performance.avatar, spriteIdleUrl])

  const saveConfig = React.useCallback(async (patch: Partial<AppConfig>): Promise<void> => {
    const res = await window.opengal.config.set(patch)
    if (!res.success || !res.data) throw new Error(res.error || '保存配置失败')
    setConfig(res.data)
    if (patch.asr) {
      try {
        await useASRStore.getState().applySettings(res.data.asr)
      } catch (error) {
        throw new Error(`设置已保存，但语音识别重载失败：${getErrorMessage(error)}`)
      }
    }
    if (patch.model) {
      setModel((prev) =>
        prev
          ? {
              ...prev,
              scale: patch.model?.scale ?? prev.scale,
              xRatio: patch.model?.xRatio ?? prev.xRatio,
              canvasYRatio: patch.model?.canvasYRatio ?? prev.canvasYRatio,
            }
          : prev,
      )
    }
  }, [])

  const handleStageTransformChange = React.useCallback(
    (next: { scale: number; xRatio: number; yRatio: number }) => {
      if (!model || !activeCard) return
      const transform = { scale: next.scale, xRatio: next.xRatio, yRatio: next.yRatio }
      void window.opengal.role.saveCard(activeCard.id, { persona: activeCard.persona, transform }).then((res) => {
        if (res.success) {
          setModel({ ...model, ...next, canvasYRatio: next.yRatio })
          void loadRoles(activeCard.id)
        }
      }).catch(() => {})
    },
    [activeCard, loadRoles, model],
  )

  async function toggleRunningFor(roleId: string): Promise<void> {
    const nextRunning = !isRoleRunning(useRoleRuntimeStore.getState().byId, roleId)
    try {
      if (window.opengal.runtime?.setRunning) {
        const res = await window.opengal.runtime.setRunning(roleId, nextRunning)
        if (!res.success) throw new Error(res.error || '运行状态切换失败')
        if (res.data) useRoleRuntimeStore.getState().hydrateSnapshot(res.data)
      } else {
        const runningRoles = {
          ...useRoleRuntimeStore.getState().byId,
          [roleId]: nextRunning,
        }
        await saveConfig({ runningRoles })
        useRoleRuntimeStore.getState().setRunning(roleId, nextRunning)
      }
      setActionError('')
    } catch {
      setActionError('角色运行状态保存失败，请重试')
    }
  }

  async function switchActiveRole(roleId: string): Promise<void> {
    await useRoleStore.getState().setActive(roleId)
    await window.opengal.runtime?.focus?.(roleId)?.catch(() => {})
    void useChatStore.getState().reloadSession(roleId)
  }

  async function switchRoleMode(mode: RoleMode): Promise<void> {
    if (!activeCard) return
    const res = await window.opengal.runtime?.setMode?.(activeCard.id, mode)
    if (res && !res.success) {
      setActionError(res.error ?? '模式切换失败')
      return
    }
    await loadRoles(activeCard.id)
  }

  async function returnToDesktopStage(): Promise<void> {
    await window.opengal.mate?.open?.()
  }

  function openSettingsTab(tab: string): void {
    useUIStateStore.getState().patch?.({ settingsTab: tab })
    setView('settings')
  }

  const activeLabel = activeCard?.displayName ?? activeCard?.name ?? '未创建角色'
  const activeMode = activeCard?.mode ?? 'agent'

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <WindowBar />

      {roles.length > 0 ? <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b bg-card px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1">
          {roles.map((role) => {
            const selected = role.id === activeId
            const isRunning = isRoleRunning(runningById, role.id)
            const rLabel = role.displayName ?? role.name
            return (
              <div
                key={role.id}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                  selected ? 'border-brand bg-brand/10 text-foreground' : 'bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    void switchActiveRole(role.id)
                    if (view === 'create') setView('chat')
                  }}
                  className="flex items-center gap-1.5 font-medium"
                >
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      isRunning ? 'bg-brand' : 'bg-muted-foreground/40',
                    )}
                  />
                  <span className="max-w-[120px] truncate">{rLabel}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleRunningFor(role.id)}
                  title={isRunning ? `让${rLabel}休息` : `唤醒${rLabel}`}
                  aria-label={isRunning ? `让${rLabel}休息` : `唤醒${rLabel}`}
                  className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {isRunning ? <Moon className="size-3" /> : <Play className="size-3" />}
                </button>
              </div>
            )
          })}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setView('create')}
            className="h-7 shrink-0 px-2 text-xs"
          >
            <Plus className="size-3.5" />
            新建角色
          </Button>
        </div>

        {roles.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void returnToDesktopStage()}
            className="h-7 shrink-0 px-2.5 text-xs"
          >
            <MonitorUp className="size-3.5" />
            回到桌面陪伴
          </Button>
        ) : null}
      </div> : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <NavRail view={view} onNavigate={setView} />



        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {actionError ? (
            <div role="alert" className="shrink-0 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
              {actionError}
            </div>
          ) : null}

          <div className={view === 'chat' ? 'flex h-full min-w-0 flex-1 flex-col' : 'hidden'}>
            {activeCard ? (
              <>
                <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-card px-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <h1 className="truncate text-sm font-semibold">{activeLabel}</h1>
                    <ContextUsageIndicator />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => useChatStore.getState().clear()}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 className="size-3.5" />
                      清空对话
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setView('role')}
                      className="h-7 px-2.5 text-xs"
                    >
                      生活与设定
                    </Button>
                  </div>
                </header>
                <div className="min-h-0 flex-1">
                  <ChatThread
                    roleLabel={activeLabel}
                    avatarUrl={activeCard.performance.avatar && avatarSource?.roleId === activeCard.id ? avatarSource.url : avatarUrl}
                    avatarRegion={activeCard.performance.avatar}
                    roleColor={activeCard.color}
                  />
                </div>
                <div className="shrink-0 border-t bg-background px-4 py-3">
                  <div className="mx-auto w-full max-w-[820px]">
                    <ChatComposerBar />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm font-medium">还没有创建角色</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  先从 mods 模组模板或空白设定创建一个独立角色，她就会出现在你的桌面与工作台中。
                </p>
                <Button type="button" size="sm" onClick={() => setView('create')}>
                  <Plus className="size-4" />
                  立即创建角色
                </Button>
              </div>
            )}
          </div>

          {view === 'create' ? (
            <RoleCreatorPanel
              onRoleCreated={() => setView('chat')}
              onOpenWorkshop={() => setView('workshop')}
              onOpenMarket={() => setView('market')}
            />
          ) : null}

          {(view === 'role' || view === 'home') ? (
            <React.Suspense fallback={null}>
              <RoleStudio
                role={activeCard}
                onClose={() => setView('create')}
                onRoleDeleted={() => {
                  if (useRoleStore.getState().list.length === 0) setView('create')
                  else setView('chat')
                }}
                onOpenDisplaySettings={() => openSettingsTab('display')}
                onOpenTtsSettings={() => openSettingsTab('tts')}
                onOpenModelSettings={() => openSettingsTab('llm')}
                avatarSrc={activeCard && avatarSource?.roleId === activeCard.id ? avatarSource.url : null}
                onRequestAvatarSrc={requestAvatarSource}
              />
            </React.Suspense>
          ) : null}

          {view === 'workshop' ? (
            <RoleWorkshopPanel
              onPreviewPortraitChange={setWorkshopPreviewUrl}
              onRoleFinalized={() => setView('chat')}
            />
          ) : null}

          {view === 'market' ? (
            <React.Suspense fallback={null}>
              <MarketPage />
            </React.Suspense>
          ) : null}

          {view === 'settings' ? (
            <div className="flex h-full w-full flex-col bg-background">
              <div className="flex h-12 shrink-0 items-center border-b px-4">
                <span className="text-sm font-semibold">设置</span>
                <button
                  type="button"
                  title="关闭"
                  aria-label="关闭设置"
                  className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setView('chat')}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                {config ? (
                  <React.Suspense fallback={null}>
                    <SettingsCenter config={config} model={model} onSave={saveConfig} />
                  </React.Suspense>
                ) : null}
              </div>
            </div>
          ) : null}

          {view === 'logs' ? <LogsPanel onClose={() => setView('chat')} /> : null}
        </main>

        {roles.length > 0 ? <aside data-role-stage className="hidden w-[320px] shrink-0 flex-col border-l bg-card/40 md:flex lg:w-[360px]">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {activeCard || workshopPreviewUrl ? (
              <RoleStageCanvas
                role={activeCard}
                model={model}
                sleeping={!activeRunning}
                outfitId={activeCard?.activeOutfitId}
                previewPortraitUrl={view === 'workshop' ? workshopPreviewUrl : null}
                onTransformChange={handleStageTransformChange}
                onSnapshot={setAvatarUrl}
                avatarRegion={activeCard?.performance.avatar}
                captureRequest={avatarCaptureRequest}
                onCapture={(url) => { if (activeCard) setAvatarSource({ roleId: activeCard.id, url }) }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
                <p>右侧创建第一个角色后，她会站在这里</p>
              </div>
            )}
          </div>

          {activeCard ? (
            <div className="flex shrink-0 flex-col gap-2 border-t bg-card px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{activeLabel}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {!activeRunning
                      ? '休息中'
                      : liveActivity || (activeMode === 'life' ? (lifePaused ? 'Life 已暂停' : 'Life 自主生活中') : 'Agent 在旁待命')}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="flex rounded-md border bg-background p-0.5">
                    <button
                      type="button"
                      onClick={() => void switchRoleMode('agent')}
                      className={cn(
                        'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                        activeMode === 'agent'
                          ? 'bg-brand text-brand-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      Agent
                    </button>
                    <button
                      type="button"
                      onClick={() => void switchRoleMode('life')}
                      className={cn(
                        'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                        activeMode === 'life'
                          ? 'bg-brand text-brand-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      Life
                    </button>
                  </div>

                  <Button
                    type="button"
                    variant={activeRunning ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => void toggleRunningFor(activeCard.id)}
                    className="h-7 px-2.5 text-xs"
                  >
                    {activeRunning ? <Moon className="size-3.5" /> : <Play className="size-3.5" />}
                    {activeRunning ? '休息' : '唤醒'}
                  </Button>
                </div>
              </div>

              {activeRunning && activeMode === 'life' ? (
                <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                  <span className="truncate text-muted-foreground">
                    {lifePaused ? '自主循环已暂停' : '自主循环运行中'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void window.opengal.runtime?.setLifePaused?.(activeCard.id, !lifePaused)}
                    className="flex shrink-0 items-center gap-1 font-medium text-brand hover:underline"
                  >
                    {lifePaused ? <Play className="size-3" /> : <Pause className="size-3" />}
                    {lifePaused ? '开始生活' : '暂停循环'}
                  </button>
                </div>
              ) : null}

              {activeCard.outfitEntries && activeCard.outfitEntries.length > 1 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">服装</span>
                  <select
                    value={activeCard.activeOutfitId ?? activeCard.performance.defaultOutfit ?? ''}
                    onChange={(e) => useRoleStore.getState().setOutfit(activeCard.id, e.target.value)}
                    className="h-7 flex-1 rounded-md border bg-background px-2 text-xs"
                  >
                    {activeCard.outfitEntries.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}
        </aside> : null}
      </div>
    </div>
  )
}
