/**
 * LLM 全局设置面板。
 *
 * 角色卡可以通过 `RoleCard.llm` 字段覆盖这里设置的任何字段；
 * 这里维护的是所有未在角色卡上指定字段的回退默认值。
 */

import * as React from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AppConfig, LLMProvider } from '@shared/types'

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
    label: 'OpenAI 兼容',
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    exampleModel: 'x-ai/grok-4.1-fast',
  },
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    defaultBaseURL: 'https://api.anthropic.com',
    exampleModel: 'claude-sonnet-4-5',
  },
]

export function SettingsDialog({ config, onSave }: SettingsDialogProps) {
  const [provider, setProvider] = React.useState<LLMProvider>('openai')
  const [baseURL, setBaseURL] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [modelName, setModelName] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (config) {
      setProvider(config.llm.provider ?? 'openai')
      setBaseURL(config.llm.baseURL)
      setApiKey(config.llm.apiKey)
      setModelName(config.llm.modelName)
    }
  }, [config])

  const currentPreset =
    PROVIDER_PRESETS.find((p) => p.value === provider) ?? PROVIDER_PRESETS[0]

  function handleProviderChange(next: string): void {
    const value = next as LLMProvider
    setProvider(value)
    // 切 provider 时若 baseURL 是另一供应商的默认值，则自动替换为新供应商默认值
    const matchedDefault = PROVIDER_PRESETS.some((p) => p.defaultBaseURL === baseURL)
    if (!baseURL || matchedDefault) {
      const preset = PROVIDER_PRESETS.find((p) => p.value === value)
      if (preset) setBaseURL(preset.defaultBaseURL)
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setStatus(null)
    try {
      await onSave({
        llm: {
          ...config?.llm,
          provider,
          baseURL: baseURL.trim(),
          apiKey: apiKey.trim(),
          modelName: modelName.trim(),
        } as AppConfig['llm'],
      })
      setStatus('已保存')
    } catch (error) {
      setStatus(`保存失败: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Settings className="size-4" /> LLM 设置
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">供应商</label>
        <Select value={provider} onValueChange={handleProviderChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Model Name</label>
        <Input
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder={currentPreset.exampleModel}
        />
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
