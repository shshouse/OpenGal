import * as React from 'react'
import { Settings, Plus, Trash2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AppConfig, LLMProvider, LLMPreset } from '@shared/types'

interface SettingsDialogProps {
  config: AppConfig | null
  onSave: (next: Partial<AppConfig>) => Promise<void>
}

interface ProviderPreset {
  value: LLMProvider
  label: string
  defaultBaseURL: string
  exampleModel: string
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    value: 'openai',
    label: 'DeepSeek',
    defaultBaseURL: 'https://api.deepseek.com',
    exampleModel: 'deepseek-chat',
  },
]

function newPresetId(): string {
  return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function SettingsDialog({ config, onSave }: SettingsDialogProps) {
  const [provider, setProvider] = React.useState<LLMProvider>('openai')
  const [baseURL, setBaseURL] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [modelName, setModelName] = React.useState('')
  const [maxTokens, setMaxTokens] = React.useState('4096')
  const [thinking, setThinking] = React.useState<'auto' | 'on' | 'off'>('auto')
  const [thinkingBudget, setThinkingBudget] = React.useState('1024')
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)

  const [presets, setPresets] = React.useState<LLMPreset[]>([])
  const [activePresetId, setActivePresetId] = React.useState<string | null>(null)
  const [editingPresetId, setEditingPresetId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (config) {
      setProvider(config.llm.provider ?? 'openai')
      setBaseURL(config.llm.baseURL)
      setApiKey(config.llm.apiKey)
      setModelName(config.llm.modelName)
      setMaxTokens(String(config.llm.maxTokens ?? 4096))
      setThinking(config.llm.thinking === undefined ? 'auto' : config.llm.thinking ? 'on' : 'off')
      setThinkingBudget(String(config.llm.thinkingBudget ?? 1024))
      setPresets(config.llmPresets ?? [])
      const match = (config.llmPresets ?? []).find(
        (p) =>
          p.baseURL === config.llm.baseURL &&
          p.modelName === config.llm.modelName &&
          p.apiKey === config.llm.apiKey,
      )
      setActivePresetId(match?.id ?? null)
    }
  }, [config])

  const currentPreset =
    PROVIDER_PRESETS.find((p) => p.value === provider) ?? PROVIDER_PRESETS[0]

  function loadPreset(p: LLMPreset): void {
    setProvider(p.provider ?? 'openai')
    setBaseURL(p.baseURL)
    setApiKey(p.apiKey)
    setModelName(p.modelName)
    setMaxTokens(String(p.maxTokens ?? 4096))
    setThinking(p.thinking === undefined ? 'auto' : p.thinking ? 'on' : 'off')
    setThinkingBudget(String(p.thinkingBudget ?? 1024))
    setEditingPresetId(p.id)
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setStatus(null)
    try {
      const currentLLM = {
        provider,
        baseURL: baseURL.trim(),
        apiKey: apiKey.trim(),
        modelName: modelName.trim(),
        maxTokens: Number(maxTokens) || 4096,
        thinking: thinking === 'auto' ? undefined : thinking === 'on',
        thinkingBudget: thinking === 'on' ? Number(thinkingBudget) || 1024 : undefined,
      } as AppConfig['llm']

      let nextPresets = [...presets]
      if (editingPresetId) {
        const idx = nextPresets.findIndex((p) => p.id === editingPresetId)
        if (idx >= 0) {
          nextPresets[idx] = { ...nextPresets[idx], ...currentLLM }
        }
      } else {
        const label = modelName.trim() || '未命名预设'
        nextPresets.push({ id: newPresetId(), label, ...currentLLM })
      }

      await onSave({
        llm: currentLLM,
        llmPresets: nextPresets,
      })
      setStatus('已保存')
    } catch (error) {
      setStatus(`保存失败: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleSwitchPreset(p: LLMPreset): Promise<void> {
    setActivePresetId(p.id)
    loadPreset(p)
    await onSave({
      llm: {
        provider: p.provider,
        baseURL: p.baseURL,
        apiKey: p.apiKey,
        modelName: p.modelName,
        maxTokens: p.maxTokens,
        thinking: p.thinking,
        thinkingBudget: p.thinkingBudget,
      } as AppConfig['llm'],
    })
  }

  async function handleDeletePreset(id: string): Promise<void> {
    const next = presets.filter((p) => p.id !== id)
    setPresets(next)
    if (activePresetId === id) setActivePresetId(null)
    if (editingPresetId === id) setEditingPresetId(null)
    await onSave({ llmPresets: next })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Settings className="size-4" /> 模型设置
      </div>

      {presets.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">模型预设</label>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                  activePresetId === p.id ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <button
                  type="button"
                  className="flex items-center gap-1 hover:underline"
                  onClick={() => void handleSwitchPreset(p)}
                >
                  {activePresetId === p.id && <Check className="size-3 text-primary" />}
                  {p.label}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => void handleDeletePreset(p.id)}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => {
                setEditingPresetId(null)
                setProvider('openai')
                setBaseURL('')
                setApiKey('')
                setModelName('')
                setMaxTokens('4096')
                setThinking('auto')
                setThinkingBudget('1024')
              }}
            >
              <Plus className="size-3" /> 新建
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">供应商</label>
        <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          DeepSeek
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Base URL</label>
        <Input
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder={currentPreset.defaultBaseURL}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">API Key</label>
        <div className="flex gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder='sk-...'
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => window.open('https://platform.deepseek.com/api_keys', '_blank')}
          >
            一键获取
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Model Name</label>
        <Input
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder={currentPreset.exampleModel}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">上下文窗口 (tokens)</label>
        <Select value={maxTokens} onValueChange={setMaxTokens}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2048">2K</SelectItem>
            <SelectItem value="4096">4K</SelectItem>
            <SelectItem value="8192">8K</SelectItem>
            <SelectItem value="16384">16K</SelectItem>
            <SelectItem value="32768">32K</SelectItem>
            <SelectItem value="65536">64K</SelectItem>
            <SelectItem value="131072">128K</SelectItem>
            <SelectItem value="1048576">1M</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          模型单次请求的最大 token 数，超出部分会被压缩或截断
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">思考模式</label>
        <Select
          value={thinking}
          onValueChange={(v) => setThinking(v as 'auto' | 'on' | 'off')}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">自动（按模型判断）</SelectItem>
            <SelectItem value="on">开启</SelectItem>
            <SelectItem value="off">关闭</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {thinking === 'on' && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">思考强度 (token 预算)</label>
          <Select value={thinkingBudget} onValueChange={setThinkingBudget}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="512">弱 (512)</SelectItem>
              <SelectItem value="1024">中 (1024)</SelectItem>
              <SelectItem value="2048">强 (2048)</SelectItem>
              <SelectItem value="4096">很强 (4096)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? '保存中...' : '保存'}
        </Button>
        {status && <span className="text-xs text-muted-foreground">{status}</span>}
      </div>
    </div>
  )
}
