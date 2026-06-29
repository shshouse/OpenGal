/**
 * 角色显示设置：调整 Live2D 模型的缩放与位置。
 *
 * - scale: 0.2 – 3.0，相对 92% 画布高度的乘数
 * - xRatio: 0 – 1，水平位置比例
 * - yRatio: 0 – 1，垂直位置比例
 *
 * 这些值通过 config.model 持久化到 electron-store。
 * 也支持在右侧面板直接拖拽移动 + 滚轮缩放（由 Live2DStage 驱动）。
 */

import * as React from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AppConfig, Live2DModelConfig } from '@shared/types'

const DEFAULTS = {
  scale: 1,
  xRatio: 0.5,
  yRatio: 0.6
}

interface CharacterDisplaySettingsProps {
  config: AppConfig | null
  model: Live2DModelConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

function NumberSlider({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (next: number) => void
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer accent-primary"
      />
    </div>
  )
}

export function CharacterDisplaySettings({
  config,
  model,
  onSave
}: CharacterDisplaySettingsProps) {
  const [scale, setScale] = React.useState(model?.scale ?? DEFAULTS.scale)
  const [xRatio, setXRatio] = React.useState(model?.xRatio ?? DEFAULTS.xRatio)
  const [yRatio, setYRatio] = React.useState(model?.canvasYRatio ?? DEFAULTS.yRatio)
  const [saving, setSaving] = React.useState(false)

  // Sync from external changes (e.g., when user drags on the canvas,
  // the parent updates model props).
  React.useEffect(() => {
    if (model) {
      setScale(model.scale)
      setXRatio(model.xRatio)
      setYRatio(model.canvasYRatio)
    }
  }, [model?.scale, model?.xRatio, model?.canvasYRatio])

  async function persist(
    nextScale: number,
    nextX: number,
    nextY: number
  ): Promise<void> {
    // 优先使用已解析的 model（来自角色卡），其次回退到 config.model
    const base = model ?? config?.model
    if (!base) return
    const updated: Live2DModelConfig = {
      ...base,
      scale: nextScale,
      xRatio: nextX,
      canvasYRatio: nextY
    }
    setSaving(true)
    try {
      await onSave({ model: updated })
    } finally {
      setSaving(false)
    }
  }

  async function reset(): Promise<void> {
    setScale(DEFAULTS.scale)
    setXRatio(DEFAULTS.xRatio)
    setYRatio(DEFAULTS.yRatio)
    await persist(DEFAULTS.scale, DEFAULTS.xRatio, DEFAULTS.yRatio)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">显示位置与缩放</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void reset()}
          className="h-6 px-2 text-xs"
          disabled={saving}
        >
          <RotateCcw className="mr-1 size-3" />
          重置为默认
        </Button>
      </div>

      <NumberSlider
        label="缩放"
        value={scale}
        min={0.2}
        max={3}
        step={0.01}
        onChange={(v) => {
          setScale(v)
          void persist(v, xRatio, yRatio)
        }}
      />
      <NumberSlider
        label="水平位置"
        value={xRatio}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => {
          setXRatio(v)
          void persist(scale, v, yRatio)
        }}
      />
      <NumberSlider
        label="垂直位置"
        value={yRatio}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => {
          setYRatio(v)
          void persist(scale, xRatio, v)
        }}
      />

      <p className="pt-1 text-[11px] text-muted-foreground">
        提示：也可以在右侧面板直接按住拖拽移动人物，滚轮缩放。
      </p>
    </div>
  )
}
