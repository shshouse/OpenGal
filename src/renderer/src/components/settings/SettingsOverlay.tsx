/**
 * 设置浮层：以窗口形式覆盖在当前页面之上，而不是切换整个主区域。
 *
 * - 半透明背板 + 居中窗口，点击背板或按 Esc 关闭
 * - 窗口内复用 SettingsCenter（Tabs 组织的各设置分页）
 * - 桌面端主页面（人物 + 对话框）始终保持在底层可见
 */

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
  // Esc 关闭
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
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
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
        <div className="flex-1 overflow-auto p-4">
          <SettingsCenter config={config} model={model} onSave={onSave} />
        </div>
      </div>
    </div>
  )
}
