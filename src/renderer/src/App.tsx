import * as React from 'react'
import { PanelRightOpen, PanelRightClose, Settings, Eye, EyeOff, ArrowLeft, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TitleBar } from '@/components/titlebar/TitleBar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { GalgameChatPanel } from '@/components/chat/GalgameChatPanel'
import { Live2DStage } from '@/components/live2d/Live2DStage'
import { SettingsCenter } from '@/components/settings/SettingsCenter'
import { LogsPanel } from '@/components/logs/LogsPanel'
import { useLogsStore } from '@/features/logs/logsStore'
import type { AppConfig, Live2DModelConfig } from '@shared/types'
import { startPipeline } from '@/features/pipeline'
import { useCharacterStore } from '@/features/character/characterStore'
import { startLogsBridge } from '@/features/logs/logsStore'
import { isMobile } from '@/lib/utils'

export default function App() {
  const [config, setConfig] = React.useState<AppConfig | null>(null)
  const [model, setModel] = React.useState<Live2DModelConfig | null>(null)
  const [showSettings, setShowSettings] = React.useState(false)
  const [petOpen, setPetOpen] = React.useState(false)
  const [mobile] = React.useState(() => isMobile())
  const loadCharacters = useCharacterStore((s) => s.loadCharacters)
  const activeId = useCharacterStore((s) => s.activeId)

  React.useEffect(() => {
    const handler = () => setShowSettings(true)
    window.addEventListener('opengal:open-settings', handler)
    return () => window.removeEventListener('opengal:open-settings', handler)
  }, [])

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
            const merged: Live2DModelConfig = {
              ...fromCard.data,
              ...(cfg.data.model?.scale !== undefined ? { scale: cfg.data.model.scale } : {}),
              ...(cfg.data.model?.xRatio !== undefined ? { xRatio: cfg.data.model.xRatio } : {}),
              ...(cfg.data.model?.canvasYRatio !== undefined
                ? { canvasYRatio: cfg.data.model.canvasYRatio }
                : {})
            }
            setModel(merged)
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
        const merged: Live2DModelConfig = {
          ...fromCard.data,
          ...(currentCfg?.model?.scale !== undefined ? { scale: currentCfg.model.scale } : {}),
          ...(currentCfg?.model?.xRatio !== undefined ? { xRatio: currentCfg.model.xRatio } : {}),
          ...(currentCfg?.model?.canvasYRatio !== undefined
            ? { canvasYRatio: currentCfg.model.canvasYRatio }
            : {})
        }
        setModel(merged)
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

  return (
    <div className="flex h-full flex-col">
      {!mobile && <TitleBar />}
      {!mobile && (
        <div className="flex h-8 items-center justify-end gap-1.5 border-b bg-background/60 px-3">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={togglePet}>
            {petOpen ? (
              <><PanelRightClose className="mr-1 size-3" />关闭桌宠</>
            ) : (
              <><PanelRightOpen className="mr-1 size-3" />打开桌宠</>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={toggleLive2D}
            disabled={!config}
          >
            {(config?.showLive2D ?? true) ? (
              <><Eye className="mr-1 size-3" />隐藏人物</>
            ) : (
              <><EyeOff className="mr-1 size-3" />显示人物</>
            )}
          </Button>
          <Button
            variant={showSettings ? 'default' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings className="mr-1 size-3" />设置
          </Button>
        </div>
      )}

      {mobile ? (
        <main className="relative flex flex-1 overflow-hidden">
          {/* 人物全屏背景 */}
          <div className="absolute inset-0">
            {config?.showLive2D ? (
              <Live2DStage model={model} onChange={handleModelChange} />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-background">
                <Button variant="ghost" size="sm" onClick={toggleLive2D}>
                  <Eye className="mr-1 size-3" />显示人物
                </Button>
              </div>
            )}
          </div>

          {/* Galgame 对话层（覆盖在人物之上） */}
          {showSettings && config ? (
            <div className="absolute inset-0 z-20 flex flex-col bg-background">
              <div className="flex h-10 items-center gap-2 border-b px-3">
                <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)}>
                  <ArrowLeft className="size-4" /> 返回
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
      ) : (
        <main className="flex flex-1 overflow-hidden">
          <section className="flex w-[44%] flex-col border-r">
            <ChatPanel />
          </section>
          <section className="flex flex-1 flex-col">
            <div className="flex-1 overflow-hidden">
              {config?.showLive2D ? (
                <Live2DStage model={model} onChange={handleModelChange} />
              ) : (
                <div className="h-full w-full bg-background" />
              )}
            </div>
            {showSettings && (
              <>
                <Separator />
                <div className="max-h-[40%] overflow-auto border-t bg-card/60 p-4">
                  <SettingsCenter config={config} model={model} onSave={saveConfig} />
                </div>
              </>
            )}
          </section>
        </main>
      )}
      {!mobile && <LogsPanel />}
    </div>
  )
}
