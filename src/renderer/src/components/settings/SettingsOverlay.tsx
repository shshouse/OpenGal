import * as React from 'react'
import { X } from 'lucide-react'
import { SettingsCenter } from './SettingsCenter'
import type { AppConfig, Live2DModelConfig } from '@shared/types'

interface SettingsOverlayProps {
  open: boolean
  onClose: () => void
  config: AppConfig | null
  model: Live2DModelConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

export function SettingsOverlay({ open, onClose, config, model, onSave }: SettingsOverlayProps) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[720px] max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
          <span className="text-sm font-semibold">设置</span>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <SettingsCenter config={config} model={model} onSave={onSave} />
        </div>
      </div>
    </div>
  )
}
