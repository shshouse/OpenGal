import * as React from 'react'
import { Mic, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { listAudioInputs } from '@/features/asr/micCapture'
import { detectSherpaKind, normalizeAsrEngine } from '@shared/asrKinds'
import type { AppConfig, ASRConfig } from '@shared/types'

const LANG_OPTIONS: Array<{ value: ASRConfig['language']; label: string }> = [
  { value: 'auto', label: '自动检测' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'yue', label: '粤语' }
]

const ENGINE_OPTIONS: Array<{ value: ASRConfig['engine']; label: string }> = [
  { value: 'sherpa', label: 'sherpa-onnx（本地离线）' }
]

interface ASRSettingsProps {
  config: AppConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

export function ASRSettings({ config, onSave }: ASRSettingsProps) {
  const [form, setForm] = React.useState<ASRConfig>({
    enabled: false,
    engine: 'sherpa',
    modelPath: '',
    language: 'zh',
    sampleRate: 16000,
    autoSend: true,
    deviceId: '',
    hotwords: [],
    vadSilenceMs: 600,
    directorEnabled: false,
    directorScreenContext: true,
    directorCooldownSec: 20
  })
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([])
  const engineDirty = form.engine !== normalizeAsrEngine(config?.asr?.engine)

  React.useEffect(() => {
    if (config?.asr) {
      const a = config.asr
      setForm({
        ...a,
        engine: normalizeAsrEngine(a.engine),
        deviceId: a.deviceId ?? '',
        hotwords: a.hotwords ?? [],
        vadSilenceMs: a.vadSilenceMs ?? 600,
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
        <Mic className="size-4" /> 语音识别
      </div>
      <p className="text-xs text-muted-foreground">
        {form.engine === 'sherpa'
          ? 'sherpa-onnx 离线识别，支持 Qwen3-ASR、SenseVoice、FunASR-Nano 等模型（自带 ASRWorker2 或系统 Python + sherpa-onnx）'
          : '自带 ASRWorker 离线识别引擎，无需安装 Python'}
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
        <label className="text-xs font-medium text-muted-foreground">识别引擎</label>
        <Select value={form.engine} onValueChange={(v) => patch({ engine: v as ASRConfig['engine'] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENGINE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {engineDirty && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">切换引擎后需重启语音识别生效</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">模型目录路径</label>
        <Input
          value={form.modelPath}
          onChange={(e) => patch({ modelPath: e.target.value })}
          placeholder='STT/models/（sherpa-onnx 发布的模型目录名）'
        />
        <p className="text-[11px] text-muted-foreground">
          从 ModelScope/HuggingFace 下载对应引擎的模型并解压
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

      {form.engine === 'sherpa' && (
        <>
          {(detectSherpaKind(form.modelPath)?.supportsHotwords ?? true) && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">热词</label>
              <Textarea
                rows={3}
                value={form.hotwords.join('\n')}
                onChange={(e) =>
                  patch({ hotwords: e.target.value.split('\n').map((w) => w.trim()).filter(Boolean) })
                }
                placeholder={'角色名、游戏术语等，每行一个'}
              />
              <p className="text-[11px] text-muted-foreground">热词不宜超过 20 个，仅 Qwen3-ASR 系模型支持</p>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">VAD 判停时长（毫秒）</label>
            <Input
              type="number"
              value={form.vadSilenceMs}
              onChange={(e) => patch({ vadSilenceMs: Number(e.target.value) || 600 })}
            />
            <p className="text-[11px] text-muted-foreground">静音持续该时长后判定一句话结束，越小出字越快但易截断</p>
          </div>
        </>
      )}

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
