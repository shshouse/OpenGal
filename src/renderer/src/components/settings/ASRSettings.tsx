import * as React from 'react'
import { Mic, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { listAudioInputs } from '@/features/asr/micCapture'
import type { AppConfig, ASRConfig } from '@shared/types'

const LANG_OPTIONS: Array<{ value: ASRConfig['language']; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' }
]

interface ASRSettingsProps {
  config: AppConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

export function ASRSettings({ config, onSave }: ASRSettingsProps) {
  const [form, setForm] = React.useState<ASRConfig>({
    enabled: false,
    modelPath: '',
    language: 'zh',
    sampleRate: 16000,
    autoSend: true,
    deviceId: '',
    directorEnabled: false,
    directorScreenContext: true,
    directorCooldownSec: 20
  })
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([])

  React.useEffect(() => {
    if (config?.asr) {
      const a = config.asr
      setForm({
        ...a,
        deviceId: a.deviceId ?? '',
        directorEnabled: a.directorEnabled ?? false,
        directorScreenContext: a.directorScreenContext ?? true,
        directorCooldownSec: a.directorCooldownSec ?? 20
      })
    }
  }, [config])

  const refreshDevices = React.useCallback(async (): Promise<void> => {
    try {
      setDevices(await listAudioInputs())
    } catch {
      setDevices([])
    }
  }, [])

  React.useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

  function patch(partial: Partial<ASRConfig>): void {
    setForm((prev) => ({ ...prev, ...partial }))
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setStatus(null)
    try {
      await onSave({ asr: form })
      setStatus('已保存')
    } catch (err) {
      setStatus(`保存失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Mic className="size-4" /> 语音识别 (Vosk)
      </div>
      <p className="text-xs text-muted-foreground">
        自带 ASRWorker 离线识别引擎，无需安装 Python
      </p>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">麦克风</label>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-2 text-[11px]"
            onClick={() => void refreshDevices()}
          >
            <RefreshCw className="mr-1 size-3" /> 刷新
          </Button>
        </div>
        <Select value={form.deviceId || 'default'} onValueChange={(v) => patch({ deviceId: v === 'default' ? '' : v })}>
          <SelectTrigger>
            <SelectValue placeholder="选择麦克风" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">系统默认</SelectItem>
            {devices.map((d) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>
                {d.label || `麦克风 (${d.deviceId.slice(0, 8)})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {devices.length === 0 && (
          <p className="text-[11px] text-muted-foreground">未检测到输入设备</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">模型目录路径</label>
        <Input
          value={form.modelPath}
          onChange={(e) => patch({ modelPath: e.target.value })}
          placeholder="STT/vosk-model-small-cn-0.22"
        />
        <p className="text-[11px] text-muted-foreground">
          从 https://alphacephei.com/vosk/models 下载模型并解压到此目录
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">识别语言</label>
        <Select value={form.language} onValueChange={(v) => patch({ language: v as ASRConfig['language'] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANG_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">采样率</label>
        <Input
          type="number"
          value={form.sampleRate}
          onChange={(e) => patch({ sampleRate: Number(e.target.value) || 16000 })}
        />
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form.autoSend}
          onChange={(e) => patch({ autoSend: e.target.checked })}
          className="rounded"
        />
        识别完成后自动发送
      </label>

      <div className="space-y-2 rounded-lg border p-2">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={form.directorEnabled}
            onChange={(e) => patch({ directorEnabled: e.target.checked })}
            className="rounded"
          />
          导演模式（由导演 AI 决定是否回应语音）
        </label>
        <p className="pl-6 text-[11px] text-muted-foreground">
          开启后语音不再直接发送，而是由导演综合语音内容、对话历史、屏幕画面判断该不该开口
        </p>
        {form.directorEnabled && (
          <>
            <label className="flex items-center gap-2 pl-6 text-xs">
              <input
                type="checkbox"
                checked={form.directorScreenContext}
                onChange={(e) => patch({ directorScreenContext: e.target.checked })}
                className="rounded"
              />
              导演可查看屏幕画面（截图会发送给 LLM）
            </label>
            <div className="pl-6">
              <label className="text-xs font-medium text-muted-foreground">回应冷却（秒）</label>
              <Input
                type="number"
                value={form.directorCooldownSec}
                onChange={(e) => patch({ directorCooldownSec: Number(e.target.value) || 0 })}
              />
              <p className="text-[11px] text-muted-foreground">两次语音回应之间的最小间隔</p>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? '保存中...' : '保存'}
        </Button>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>
    </div>
  )
}
