import * as React from 'react'
import { Mic, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox, CheckboxIndicator } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { listAudioInputs } from '@/features/asr/micCapture'
import { detectSherpaKind, normalizeAsrEngine, normalizeAsrMode } from '@shared/asrKinds'
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
  { value: 'sherpa', label: 'sherpa-onnx（本地）' }
]

const MODE_OPTIONS: Array<{ value: ASRConfig['mode']; label: string }> = [
  { value: 'offline', label: '离线（准确优先，Qwen3/SenseVoice）' },
  { value: 'streaming', label: '流式（低延迟，Zipformer 中文）' }
]

interface ASRSettingsProps {
  config: AppConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

export function ASRSettings({ config, onSave }: ASRSettingsProps) {
  const [form, setForm] = React.useState<ASRConfig>({
    enabled: false,
    engine: 'sherpa',
    mode: 'offline',
    modelPath: '',
    language: 'zh',
    sampleRate: 16000,
    autoSend: true,
    deviceId: '',
    hotwords: [],
    vadSilenceMs: 600,
    directorEnabled: false,
    directorScreenContext: false,
    directorCooldownSec: 20,
    directorInitiativeEnabled: false,
    directorInitiativePerHour: 3,
    directorIdleMinutes: 10
  })
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([])
  const formRef = React.useRef(form)
  const pending = React.useRef<ASRConfig | null>(null)
  const ready = React.useRef(false)
  const inFlight = React.useRef(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = React.useRef(true)
  const save = React.useRef(onSave)
  save.current = onSave

  React.useEffect(() => {
    if (config?.asr && !pending.current && !inFlight.current) {
      const a = config.asr
      const next = {
        ...a,
        engine: normalizeAsrEngine(a.engine),
        mode: normalizeAsrMode(a.mode),
        deviceId: a.deviceId ?? '',
        hotwords: a.hotwords ?? [],
        vadSilenceMs: a.vadSilenceMs ?? 600,
        directorEnabled: a.directorEnabled ?? false,
        directorScreenContext: a.directorScreenContext ?? false,
        directorCooldownSec: a.directorCooldownSec ?? 20,
        directorInitiativeEnabled: a.directorInitiativeEnabled ?? false,
        directorInitiativePerHour: a.directorInitiativePerHour ?? 3,
        directorIdleMinutes: a.directorIdleMinutes ?? 10
      }
      formRef.current = next
      setForm(next)
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

  async function applyPending(): Promise<void> {
    if (inFlight.current || !ready.current) return
    inFlight.current = true
    if (mounted.current) setSaving(true)
    try {
      while (pending.current && ready.current) {
        const next = pending.current
        pending.current = null
        ready.current = false
        if (!Number.isInteger(next.sampleRate) || next.sampleRate < 8000 || next.sampleRate > 48000 || !Number.isFinite(next.vadSilenceMs) || next.vadSilenceMs < 100 || !Number.isFinite(next.directorCooldownSec) || next.directorCooldownSec < 0) {
          if (mounted.current) setStatus('未应用：采样率须为 8000–48000 的整数，VAD 至少 100 毫秒，冷却不能为负数')
          continue
        }
        if (mounted.current) setStatus('正在应用设置…')
        try {
          await save.current({ asr: next })
          if (mounted.current && !pending.current) setStatus('已应用；运行中的识别已同步，无需手动重开')
        } catch (error) {
          if (mounted.current) setStatus(`应用失败：${(error as Error).message}`)
        }
      }
    } finally {
      inFlight.current = false
      if (mounted.current) setSaving(false)
    }
  }

  function patch(partial: Partial<ASRConfig>): void {
    const next = { ...formRef.current, ...partial }
    formRef.current = next
    setForm(next)
    pending.current = next
    ready.current = false
    setStatus('等待应用…')
    if (timer.current) clearTimeout(timer.current)
    const immediate = Object.entries(partial).some(([key, value]) => typeof value === 'boolean' || ['deviceId', 'language', 'engine', 'mode'].includes(key))
    timer.current = setTimeout(() => { ready.current = true; void applyPending() }, immediate ? 0 : 600)
  }

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      ready.current = true
      void applyPending()
    }
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Mic className="size-4" /> 语音识别
      </div>
      <p className="text-xs text-muted-foreground">
        {form.mode === 'streaming'
          ? '流式 Zipformer：边说边出字，适合低延迟对话。需要系统 Python + sherpa-onnx，以及 sherpa-onnx-streaming-zipformer-zh-* 模型目录。'
          : '离线识别：准确优先，支持 Qwen3-ASR、SenseVoice、FunASR-Nano 等模型（自带 ASRWorker2 或系统 Python + sherpa-onnx）。'}
      </p>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {status || '修改自动应用：麦克风、语言和开关立即生效；文本参数停止输入后应用。运行中会按需自动重载。'}
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
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">识别模式</label>
        <Select value={form.mode} onValueChange={(v) => patch({ mode: v as ASRConfig['mode'] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">模型目录路径</label>
        <Input
          value={form.modelPath}
          onChange={(e) => patch({ modelPath: e.target.value })}
          placeholder={form.mode === 'streaming'
            ? 'resources/models/asr/sherpa-onnx-streaming-zipformer-zh-xlarge-int8-2025-06-30'
            : 'STT/models/（sherpa-onnx 发布的模型目录名）'}
        />
        <p className="text-[11px] text-muted-foreground">
          {form.mode === 'streaming'
            ? '流式模式只支持 sherpa-onnx-streaming-zipformer-* 中文模型；需要 encoder/decoder/joiner/tokens.txt'
            : '从 ModelScope/HuggingFace 下载对应引擎的模型并解压'}
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
          {form.mode === 'offline' && (detectSherpaKind(form.modelPath)?.supportsHotwords ?? true) && (
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
            <p className="text-[11px] text-muted-foreground">
              静音持续该时长后判定一句话结束，越小出字越快但易截断；流式模式下作为端点静音阈值
            </p>
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-xs">
        <span className="relative inline-flex">
          <Checkbox checked={form.autoSend} onChange={(e) => patch({ autoSend: e.target.checked })} />
          <CheckboxIndicator />
        </span>
        识别完成后自动发送
      </label>

      <div className="space-y-2 rounded-lg border p-2">
        <label className="flex items-center gap-2 text-xs font-medium">
          <span className="relative inline-flex">
            <Checkbox
              checked={form.directorEnabled}
              onChange={(e) => patch({ directorEnabled: e.target.checked })}
            />
            <CheckboxIndicator />
          </span>
          导演模式
        </label>
        <p className="pl-6 text-[11px] text-muted-foreground">
          开启后语音不再直接发送，而是由导演综合语音内容、对话历史、屏幕画面判断该不该开口
        </p>
        {form.directorEnabled && (
          <>
            <label className="flex items-center gap-2 pl-6 text-xs">
              <span className="relative inline-flex">
                <Checkbox
                  checked={form.directorScreenContext}
                  onChange={(e) => patch({ directorScreenContext: e.target.checked })}
                />
                <CheckboxIndicator />
              </span>
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
            <div className="space-y-2 border-t pl-6 pt-2">
              <label className="flex items-center gap-2 text-xs">
                <span className="relative inline-flex">
                  <Checkbox
                    checked={form.directorInitiativeEnabled}
                    onChange={(e) => patch({ directorInitiativeEnabled: e.target.checked })}
                  />
                  <CheckboxIndicator />
                </span>
                允许主动开口
              </label>
              <p className="pl-6 text-[11px] text-muted-foreground">
                开启后，对方静默超过设定时间时由导演判断要不要主动说一句；没有具体理由就不说
              </p>
              {form.directorInitiativeEnabled && (
                <>
                  <div className="pl-6">
                    <label className="text-xs font-medium text-muted-foreground">静默多少分钟后允许主动</label>
                    <Input
                      type="number"
                      value={form.directorIdleMinutes}
                      onChange={(e) => patch({ directorIdleMinutes: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="pl-6">
                    <label className="text-xs font-medium text-muted-foreground">每小时最多主动几次</label>
                    <Input
                      type="number"
                      value={form.directorInitiativePerHour}
                      onChange={(e) => patch({ directorInitiativePerHour: Number(e.target.value) || 0 })}
                    />
                    <p className="text-[11px] text-muted-foreground">填 0 表示不限</p>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {saving && <p className="text-xs text-muted-foreground">正在同步识别设置…</p>}
    </div>
  )
}
