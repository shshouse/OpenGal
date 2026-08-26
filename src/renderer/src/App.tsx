import * as React from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TitleBar } from '@/components/titlebar/TitleBar'
import { GalgameChatPanel } from '@/components/chat/GalgameChatPanel'
import { Live2DStage } from '@/components/live2d/Live2DStage'
import { SettingsCenter } from '@/components/settings/SettingsCenter'
import { SettingsOverlay } from '@/components/settings/SettingsOverlay'
import { LogsPanel } from '@/components/logs/LogsPanel'
import { Sidebar } from '@/components/nav/Sidebar'
import { useLogsStore } from '@/features/logs/logsStore'
import type { AppConfig, Live2DModelConfig } from '@shared/types'
import { startPipeline } from '@/features/pipeline'
import { useCharacterStore } from '@/features/character/characterStore'
import { startLogsBridge } from '@/features/logs/logsStore'
import { isMobile } from '@/lib/utils'

/**
 * 把全局持久化的变换（scale/xRatio/canvasYRatio）合并到角色卡解析出的模型配置上。
 * 仅当持久化值属于同一个模型（modelPath 相同）时才套用——否则上一个角色调的位置/缩放
 * 会串到当前角色，导致人物被放大到只剩局部、头被裁掉。不同角色时用角色卡自带默认值。
 */
function mergeSavedTransform(
  cardConfig: Live2DModelConfig,
  saved: Live2DModelConfig | null | undefined
): Live2DModelConfig {
  const sameModel = !!saved?.modelPath && saved.modelPath === cardConfig.modelPath
  return {
    ...cardConfig,
    ...(sameModel && saved?.scale !== undefined ? { scale: saved.scale } : {}),
    ...(sameModel && saved?.xRatio !== undefined ? { xRatio: saved.xRatio } : {}),
    ...(sameModel && saved?.canvasYRatio !== undefined
      ? { canvasYRatio: saved.canvasYRatio }
      : {})
  }
}

export default function App() {
  const [config, setConfig] = React.useState<AppConfig | null>(null)
  const [model, setModel] = React.useState<Live2DModelConfig | null>(null)
  const [petOpen, setPetOpen] = React.useState(false)
  const [mobile] = React.useState(() => isMobile())
  const loadCharacters = useCharacterStore((s) => s.loadCharacters)
  const activeId = useCharacterStore((s) => s.activeId)

  React.useEffect(() => {
    const handler = () => setShowSettings(true)
    window.addEventListener('opengal:open-settings', handler)
    return () => window.removeEventListener('opengal:open-settings', handler)
  }, [])

  // 设置浮层开关：桌面端为居中窗口浮层，移动端为全屏浮层（均覆盖在当前页之上）
  const [showSettings, setShowSettings] = React.useState(false)

  // 启动流水线（LLMWorker / TTSWorker / UIWorker）
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
        // 加载角色卡列表，按 config.activeCharacterId 选中（缺省自动取第一张）
        await loadCharacters(cfg.data.activeCharacterId)
        // 模型加载优先级：角色卡 live2d 配置 + 用户持久化覆盖 > 全局配置 > 默认模型
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

  // 切换角色时从角色卡 live2d 配置重新解析模型
  React.useEffect(() => {
    if (!activeId) return
    void (async () => {
      const fromCard = await window.opengal.model.resolveFromCard(activeId)
      if (fromCard.success && fromCard.data) {
        const currentCfg = (await window.opengal.config.get()).data
        setModel(mergeSavedTransform(fromCard.data, currentCfg?.model))
      } else {
        // 角色卡无 live2d 配置时回退到全局配置
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
    // 如果 patch 包含 model，同步到本地 model 状态，让 Live2DStage 立即重绘
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

  function openLogs(): void {
    useLogsStore.getState().setPanelOpen(true)
  }

  // Live2DStage 从画布拖拽/滚轮调整位置/缩放的回调
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

  if (mobile) {
    return (
      <div className="flex h-full flex-col">
        <main className="relative flex flex-1 overflow-hidden">
          {/* 人物全屏背景 */}
          <div className="absolute inset-0">
            {config?.showLive2D ? (
              <Live2DStage model={model} onChange={handleModelChange} />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-background">
                <Button variant="ghost" size="sm" onClick={toggleLive2D}>
                  <Settings className="size-4" />显示人物
                </Button>
              </div>
            )}
          </div>

          {/* Galgame 对话层（覆盖在人物之上） */}
          {showSettings && config ? (
            <div className="absolute inset-0 z-20 flex flex-col bg-background">
              <div className="flex h-10 items-center gap-2 border-b px-3">
                <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)}>
                  返回
                </Button>
                <span className="text-sm font-semibold">设置</span>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <SettingsCenter config={config} model={model} onSave={saveConfig} />
              </div>
            </div>
          ) : (
            <>
              {/* 右上角：设置齿轮 */}
              <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 rounded-full bg-background/60 p-0 backdrop-blur-sm"
                  onClick={() => setShowSettings(true)}
                  title="设置"
                >
                  <Settings className="size-4" />
                </Button>
              </div>
              <GalgameChatPanel />
            </>
          )}
        </main>
      </div>
    )
  }

  // 桌面端：左侧导航栏 + 主区域（人物居中 + 底部对话框）。设置为覆盖浮层，不切换主页面。
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          onOpenSettings={() => setShowSettings(true)}
          petOpen={petOpen}
          onTogglePet={() => void togglePet()}
          showLive2D={config?.showLive2D ?? true}
          onToggleLive2D={() => void toggleLive2D()}
          onOpenLogs={openLogs}
        />
        <main className="relative flex flex-1 overflow-hidden">
          <div className="absolute inset-0">
            {config?.showLive2D ? (
              <Live2DStage model={model} onChange={handleModelChange} />
            ) : (
              <div className="h-full w-full bg-background" />
            )}
          </div>
          <GalgameChatPanel />
          <SettingsOverlay
            open={showSettings}
            onClose={() => setShowSettings(false)}
            config={config}
            model={model}
            onSave={saveConfig}
          />
        </main>
      </div>
      <LogsPanel />
    </div>
  )
}
