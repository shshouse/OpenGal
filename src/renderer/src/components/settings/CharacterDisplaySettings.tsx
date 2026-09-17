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
  const [greetingEnabled, setGreetingEnabled] = React.useState(config?.startup.greetingEnabled ?? true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (model) {
      setScale(model.scale)
      setXRatio(model.xRatio)
      setYRatio(model.canvasYRatio)
    }
  }, [model?.scale, model?.xRatio, model?.canvasYRatio])

  React.useEffect(() => {
    if (config) setGreetingEnabled(config.startup.greetingEnabled)
  }, [config?.startup.greetingEnabled])

  async function persist(
    nextScale: number,
    nextX: number,
    nextY: number
  ): Promise<void> {
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

      <div className="flex items-center justify-between border-t pt-4">
        <div className="space-y-0.5">
          <div className="text-sm font-semibold">启动唤醒</div>
          <p className="text-xs text-muted-foreground">启动自检完成后，自动开口打招呼</p>
        </div>
        <input
          type="checkbox"
          checked={greetingEnabled}
          disabled={saving}
          onChange={(e) => {
            setGreetingEnabled(e.target.checked)
            void onSave({ startup: { greetingEnabled: e.target.checked } })
          }}
          className="size-4"
        />
      </div>
    </div>
  )
}
