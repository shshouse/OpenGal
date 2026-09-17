import * as React from 'react'
import { X } from 'lucide-react'
import { TitleBar } from '@/components/titlebar/TitleBar'
import { GalgameChatPanel } from '@/components/chat/GalgameChatPanel'
import { Live2DStage } from '@/components/live2d/Live2DStage'
import { SettingsCenter } from '@/components/settings/SettingsCenter'
import { LogsPanel } from '@/components/logs/LogsPanel'
import { MarketPage } from '@/components/market/MarketPage'
import { Sidebar } from '@/components/nav/Sidebar'
import { useLogsStore } from '@/features/logs/logsStore'
import type { AppConfig, Live2DModelConfig } from '@shared/types'
import { startPipeline } from '@/features/pipeline'
import { useCharacterStore } from '@/features/character/characterStore'
import { startLogsBridge } from '@/features/logs/logsStore'
import { mergeSavedTransform } from '@/features/live2d/modelTransform'
import { useStartupStore } from '@/features/startup/startupStore'
import { BootOverlay } from '@/components/startup/BootOverlay'

type View = 'chat' | 'market' | 'settings' | 'logs'
const VIEW_ORDER: View[] = ['chat', 'market', 'settings', 'logs']

export default function App() {
  const [config, setConfig] = React.useState<AppConfig | null>(null)
  const [model, setModel] = React.useState<Live2DModelConfig | null>(null)
  const [petOpen, setPetOpen] = React.useState(false)
  const [view, setView] = React.useState<View>('chat')
  const loadCharacters = useCharacterStore((s) => s.loadCharacters)
  const activeId = useCharacterStore((s) => s.activeId)

  React.useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      const idx = VIEW_ORDER.indexOf(view)
      if (e.button === 3 && idx > 0) {
        e.preventDefault()
        setView(VIEW_ORDER[idx - 1])
      } else if (e.button === 4 && idx < VIEW_ORDER.length - 1) {
        e.preventDefault()
        setView(VIEW_ORDER[idx + 1])
      }
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [view])

  React.useEffect(() => {
    const handler = () => setView('settings')
    window.addEventListener('opengal:open-settings', handler)
    return () => window.removeEventListener('opengal:open-settings', handler)
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
        useStartupStore.getState().beginBoot()
        if (!cfg.data.showLive2D) useStartupStore.getState().reportLive2d('skipped')
        await loadCharacters(cfg.data.activeCharacterId)
        const active = useCharacterStore.getState().getActive()
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
  }, [loadCharacters])

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
    if (patch.model && model) {
      setModel({
        ...model,
        scale: patch.model.scale ?? model.scale,
        xRatio: patch.model.xRatio ?? model.xRatio,
        canvasYRatio: patch.model.canvasYRatio ?? model.canvasYRatio
      })
    }
  }

  async function togglePet(): Promise<void> {
    if (petOpen) {
      await window.opengal.pet.close()
      setPetOpen(false)
    } else {
      await window.opengal.pet.open()
      setPetOpen(true)
    }
  }

  async function toggleLive2D(): Promise<void> {
    const next = !(config?.showLive2D ?? true)
    await saveConfig({ showLive2D: next })
  }

  const handleModelChange = React.useCallback(
    (next: { scale: number; xRatio: number; yRatio: number }) => {
      if (!model) return
      void saveConfig({
        model: {
          ...model,
          scale: next.scale,
          xRatio: next.xRatio,
          canvasYRatio: next.yRatio
        }
      })
    },
    [model]
  )

  const live2dLayer = config?.showLive2D ? (
    <Live2DStage model={model} onChange={handleModelChange} />
  ) : (
    <div className="h-full w-full bg-background" />
  )

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        onOpenChat={() => setView('chat')}
        chatActive={view === 'chat'}
        onOpenSettings={() => setView('settings')}
        onOpenMarket={() => setView('market')}
        marketActive={view === 'market'}
        petOpen={petOpen}
        onTogglePet={() => void togglePet()}
        showLive2D={config?.showLive2D ?? true}
        onToggleLive2D={() => void toggleLive2D()}
        onOpenLogs={() => setView('logs')}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar />
        <main className="relative flex flex-1 overflow-hidden">
          {view === 'chat' && (
            <>
              <div className="absolute inset-0">{live2dLayer}</div>
              <GalgameChatPanel />
              <BootOverlay />
            </>
          )}

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

          {view === 'logs' && (
            <div className="flex h-full w-full flex-col bg-background">
              <div className="flex h-12 shrink-0 items-center border-b px-4">
                <span className="text-sm font-semibold">日志</span>
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
                <LogsPanel forceOpen />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
