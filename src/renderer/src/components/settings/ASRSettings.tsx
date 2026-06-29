import * as React from 'react'
import { Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
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
    autoSend: true
  })
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (config?.asr) setForm(config.asr)
  }, [config])

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
        需要 Python 环境且已安装 vosk：pip install vosk
      </p>

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

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? '保存中...' : '保存'}
        </Button>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>
    </div>
  )
}
