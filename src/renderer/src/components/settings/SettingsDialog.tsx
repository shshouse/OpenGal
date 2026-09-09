import * as React from 'react'
import { Plus, Trash2, Pencil, Box, ChevronRight, ChevronDown, X, Eye, EyeOff } from 'lucide-react'
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

interface ProviderTemplate {
  key: string
  label: string
  defaultBaseURL: string
  exampleModel: string
}

// OpenAI 兼容服务商模板（添加自定义模型时选择）
const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  { key: 'deepseek', label: 'DeepSeek', defaultBaseURL: 'https://api.deepseek.com', exampleModel: 'deepseek-chat' },
  { key: 'openai', label: 'OpenAI', defaultBaseURL: 'https://api.openai.com/v1', exampleModel: 'gpt-4o' },
  { key: 'moonshot', label: 'Moonshot', defaultBaseURL: 'https://api.moonshot.cn/v1', exampleModel: 'moonshot-v1-8k' },
  { key: 'zhipu', label: 'Bigmodel', defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4', exampleModel: 'glm-4-flash' },
  { key: 'siliconflow', label: '硅基流动', defaultBaseURL: 'https://api.siliconflow.cn/v1', exampleModel: 'deepseek-ai/DeepSeek-V3' },
  { key: 'openrouter', label: 'OpenRouter', defaultBaseURL: 'https://openrouter.ai/api/v1', exampleModel: 'openai/gpt-4o' },
]

// 内置模型：开箱即用（与 config.llm 同构，首次进入时自动写入）
const BUILTIN_MODEL: LLMPreset = {
  id: 'builtin_deepseek_v41_flash',
  label: 'DeepSeek-V4.1-Flash',
  provider: 'openai',
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  modelName: 'deepseek-v4.1-flash-expires-on-0910',
  maxTokens: 4096,
  contextWindow: 131072,
  multimodal: false,
}

function providerLabel(baseURL: string): string {
  const host = baseURL.replace(/^https?:\/\//, '').split('/')[0]
  const hit = PROVIDER_TEMPLATES.find((t) => host === t.defaultBaseURL.replace(/^https?:\/\//, '').split('/')[0])
  return hit ? hit.label : host || '自定义'
}

function newPresetId(): string {
  return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function Toggle({ on, onClick, title }: { on: boolean; onClick: () => void; title: string }): React.ReactElement {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        on ? 'bg-emerald-500' : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${
          on ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

const CONTEXT_PRESETS = ['128000', '256000', '512000', '1000000']
const OUTPUT_PRESETS = ['4096', '16384', '32768', '128000']

interface ModelForm {
  provider: LLMProvider
  baseURL: string
  apiKey: string
  modelName: string
  maxTokens: string
  contextWindow: string
  multimodal: boolean
  thinking: 'auto' | 'on' | 'off'
  thinkingBudget: string
}

const EMPTY_FORM: ModelForm = {
  provider: 'openai',
  baseURL: '',
  apiKey: '',
  modelName: '',
  maxTokens: '4096',
  contextWindow: '131072',
  multimodal: false,
  thinking: 'auto',
  thinkingBudget: '1024',
}

export function SettingsDialog({ config, onSave }: SettingsDialogProps) {
  const [presets, setPresets] = React.useState<LLMPreset[]>([])
  const [activePresetId, setActivePresetId] = React.useState<string | null>(null)
  // null=列表视图；'new'=选服务商/新建；'custom'=自定义表单；其他=预设 id（编辑）
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [pickedTemplate, setPickedTemplate] = React.useState<ProviderTemplate | null>(null)
  const [form, setForm] = React.useState<ModelForm>({ ...EMPTY_FORM })
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const [showKey, setShowKey] = React.useState(false)
  const [modelOptions, setModelOptions] = React.useState<string[]>([])
  const [loadingModels, setLoadingModels] = React.useState(false)
  const [modelFetchError, setModelFetchError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)
  const [builtinExpanded, setBuiltinExpanded] = React.useState(false)
  const [customExpanded, setCustomExpanded] = React.useState(true)

  React.useEffect(() => {
    if (!config) return
    let list = config.llmPresets ?? []
    // 首次使用：内置模型尚未入列时注入（不含 key，用户在编辑时填）
    if (!list.some((p) => p.id === BUILTIN_MODEL.id)) {
      list = [BUILTIN_MODEL, ...list]
    }
    setPresets(list)
    const cur = config.llm
    const match = list.find(
      (p) =>
        p.baseURL === cur.baseURL &&
        p.modelName === cur.modelName &&
        (p.apiKey || '') === (cur.apiKey || ''),
    )
    setActivePresetId(match?.id ?? null)
  }, [config])

  function startNew(): void {
    setPickedTemplate(null)
    setForm({ ...EMPTY_FORM })
    setEditingId('new')
    setModelOptions([])
    setModelFetchError(null)
    setStatus(null)
  }

  function startEdit(p: LLMPreset): void {
    setPickedTemplate(null)
    setForm({
      provider: p.provider ?? 'openai',
      baseURL: p.baseURL,
      apiKey: p.apiKey,
      modelName: p.modelName,
      maxTokens: String(p.maxTokens ?? 4096),
      contextWindow: String(p.contextWindow ?? 131072),
      multimodal: p.multimodal ?? false,
      thinking: p.thinking === undefined ? 'auto' : p.thinking ? 'on' : 'off',
      thinkingBudget: String(p.thinkingBudget ?? 1024),
    })
    setEditingId(p.id)
    setModelOptions([])
    setModelFetchError(null)
    setStatus(null)
  }

  async function fetchModels(baseURL: string, apiKey: string): Promise<void> {
    if (!baseURL.trim()) return
    setLoadingModels(true)
    setModelFetchError(null)
    try {
      const res = await window.opengal.llm.listModels(baseURL.trim(), apiKey.trim())
      if (res.success && Array.isArray(res.data)) {
        setModelOptions(res.data)
      } else {
        setModelFetchError(res.error || '拉取失败')
      }
    } catch (e) {
      setModelFetchError((e as Error).message)
    } finally {
      setLoadingModels(false)
    }
  }

  function buildLLM(): AppConfig['llm'] {
    return {
      provider: form.provider,
      baseURL: form.baseURL.trim(),
      apiKey: form.apiKey.trim(),
      modelName: form.modelName.trim(),
      maxTokens: Number(form.maxTokens) || 4096,
      contextWindow: Number(form.contextWindow) || 131072,
      multimodal: form.multimodal,
      thinking: form.thinking === 'auto' ? undefined : form.thinking === 'on',
      thinkingBudget: form.thinking === 'on' ? Number(form.thinkingBudget) || 1024 : undefined,
    } as AppConfig['llm']
  }

  async function handleSave(): Promise<void> {
    if (!form.baseURL.trim() || !form.modelName.trim()) {
      setStatus('Base URL 和模型名不能为空')
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      const llm = buildLLM()
      let nextPresets = [...presets]
      let newActive = activePresetId

      if (editingId === 'new' || editingId === 'custom') {
        const preset: LLMPreset = {
          id: newPresetId(),
          label: llm.modelName ?? '未命名',
          ...llm,
        }
        nextPresets.push(preset)
        newActive = preset.id
      } else if (editingId) {
        const idx = nextPresets.findIndex((p) => p.id === editingId)
        if (idx >= 0) {
          const isBuiltin = nextPresets[idx].id === BUILTIN_MODEL.id
          // 内置模型编辑后转为自定义条目（保留内置行不动）
          const updated: LLMPreset = isBuiltin
            ? { ...BUILTIN_MODEL, ...llm, id: newPresetId(), label: llm.modelName ?? BUILTIN_MODEL.label }
            : { ...nextPresets[idx], ...llm, label: llm.modelName ?? nextPresets[idx].label }
          nextPresets[idx] = updated
          if (activePresetId === editingId) newActive = updated.id
        }
      }

      const activate = editingId === 'new' || editingId === 'custom' || editingId === activePresetId || activePresetId === BUILTIN_MODEL.id
      const payload: Partial<AppConfig> = { llmPresets: nextPresets }
      if (activate) {
        payload.llm = llm
        setActivePresetId(newActive)
      }
      setPresets(nextPresets)
      await onSave(payload)
      setEditingId(null)
      setStatus('已保存')
    } catch (error) {
      setStatus(`保存失败: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleSwitch(p: LLMPreset): Promise<void> {
    if (p.id === activePresetId) return
    if (!p.apiKey) {
      // 无 key 的内置模型：转编辑模式填 key
      startEdit(p)
      return
    }
    setActivePresetId(p.id)
    await onSave({
      llm: {
        provider: p.provider,
        baseURL: p.baseURL,
        apiKey: p.apiKey,
        modelName: p.modelName,
        maxTokens: p.maxTokens,
        contextWindow: p.contextWindow,
        multimodal: p.multimodal,
        thinking: p.thinking,
        thinkingBudget: p.thinkingBudget,
      } as AppConfig['llm'],
    })
  }

  async function handleDelete(id: string): Promise<void> {
    const next = presets.filter((p) => p.id !== id)
    setPresets(next)
    if (activePresetId === id) setActivePresetId(null)
    if (editingId === id) setEditingId(null)
    await onSave({ llmPresets: next })
  }

  const currentTemplate =
    PROVIDER_TEMPLATES.find(
      (t) => form.baseURL && form.baseURL.startsWith(t.defaultBaseURL),
    ) ?? pickedTemplate

  // ---- 编辑对话框（服务商选择 / 表单） ----
  const editorOpen = editingId !== null

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">模型管理</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          配置 API key 添加更多可用模型，预置模型默认使用稳定版本。
        </p>
      </div>

      {!editorOpen && (
        <Button type="button" size="sm" className="gap-1" onClick={startNew}>
          <Plus className="size-3.5" /> 添加模型
        </Button>
      )}

      {/* 编辑对话框 */}
      {editorOpen && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h4 className="text-sm font-semibold">
              {editingId === 'new' ? '添加自定义模型' : editingId === 'custom' ? '自定义模型' : '编辑模型'}
            </h4>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setEditingId(null)}
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-4 p-5">
            {/* 步骤 1：自定义新建 → 选服务商 */}
            {editingId === 'new' && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PROVIDER_TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className="flex items-center justify-between rounded-lg border bg-background px-4 py-3 text-sm transition-colors hover:bg-accent"
                    onClick={() => {
                      setPickedTemplate(t)
                      setForm((f) => ({
                        ...f,
                        baseURL: t.defaultBaseURL,
                        modelName: t.exampleModel,
                      }))
                      setEditingId('custom')
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Box className="size-4 text-muted-foreground" />
                      {t.label}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            {/* 步骤 2：表单 */}
            {editingId !== 'new' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    <span className="text-red-400">* </span>服务商
                  </label>
                  <Select
                    value={pickedTemplate?.key ?? ''}
                    onValueChange={(key) => {
                      const t = PROVIDER_TEMPLATES.find((x) => x.key === key)
                      if (!t) return
                      setPickedTemplate(t)
                      setForm((f) => ({ ...f, baseURL: t.defaultBaseURL }))
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择服务商" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDER_TEMPLATES.map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    <span className="text-red-400">* </span>模型
                  </label>
                  {modelOptions.length > 0 ? (
                    <Select value={form.modelName} onValueChange={(v) => setForm((f) => ({ ...f, modelName: v }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {modelOptions.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={form.modelName}
                      onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))}
                      placeholder={currentTemplate?.exampleModel ?? '模型名'}
                    />
                  )}
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">
                      {loadingModels
                        ? '正在拉取模型列表...'
                        : modelFetchError
                          ? `拉取失败: ${modelFetchError}`
                          : ''}
                    </span>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      disabled={loadingModels}
                      onClick={() => void fetchModels(form.baseURL, form.apiKey)}
                    >
                      拉取模型列表
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">API 密钥</label>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => window.open('https://platform.deepseek.com/api_keys', '_blank')}
                    >
                      获取 API 密钥
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={form.apiKey}
                      onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowKey((v) => !v)}
                    >
                      {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {/* 高级配置 */}
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  高级配置
                  {showAdvanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>

                {showAdvanced && (
                  <div className="space-y-4 rounded-md border bg-background/50 p-4">
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">上下文窗口（Token）</label>
                      <div className="flex items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center rounded-md border">
                          <span className="shrink-0 border-r px-2.5 py-2 text-xs text-muted-foreground">输入</span>
                          <input
                            className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm outline-none"
                            value={form.contextWindow}
                            onChange={(e) => setForm((f) => ({ ...f, contextWindow: e.target.value.replace(/\D/g, '') }))}
                          />
                        </div>
                        <div className="flex shrink-0 gap-2 text-[11px]">
                          {CONTEXT_PRESETS.map((v) => (
                            <button
                              key={v}
                              type="button"
                              className={`hover:underline ${form.contextWindow === v ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
                              onClick={() => setForm((f) => ({ ...f, contextWindow: v }))}
                            >
                              {Number(v) >= 1000000 ? `${Number(v) / 1000000}M` : `${Number(v) / 1000}k`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center rounded-md border">
                          <span className="shrink-0 border-r px-2.5 py-2 text-xs text-muted-foreground">输出</span>
                          <input
                            className="min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm outline-none"
                            value={form.maxTokens}
                            onChange={(e) => setForm((f) => ({ ...f, maxTokens: e.target.value.replace(/\D/g, '') }))}
                          />
                        </div>
                        <div className="flex shrink-0 gap-2 text-[11px]">
                          {OUTPUT_PRESETS.map((v) => (
                            <button
                              key={v}
                              type="button"
                              className={`hover:underline ${form.maxTokens === v ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
                              onClick={() => setForm((f) => ({ ...f, maxTokens: v }))}
                            >
                              {Number(v) >= 1000 ? `${Number(v) / 1000}k` : v}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">支持图片输入（多模态）</label>
                      <div className="flex items-center gap-5 text-sm">
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="radio"
                            name="multimodal"
                            checked={form.multimodal}
                            onChange={() => setForm((f) => ({ ...f, multimodal: true }))}
                          />
                          支持
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="radio"
                            name="multimodal"
                            checked={!form.multimodal}
                            onChange={() => setForm((f) => ({ ...f, multimodal: false }))}
                          />
                          不支持
                        </label>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">思考模式</label>
                      <div className="flex items-center gap-5 text-sm">
                        {([
                          ['auto', '跟随模型默认配置'],
                          ['on', '开启'],
                          ['off', '关闭'],
                        ] as const).map(([v, label]) => (
                          <label key={v} className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="radio"
                              name="thinking"
                              checked={form.thinking === v}
                              onChange={() => setForm((f) => ({ ...f, thinking: v }))}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      {form.thinking === 'on' && (
                        <Input
                          value={form.thinkingBudget}
                          onChange={(e) => setForm((f) => ({ ...f, thinkingBudget: e.target.value.replace(/\D/g, '') }))}
                          placeholder="思考 token 预算（如 1024）"
                          className="mt-1"
                        />
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    取消
                  </Button>
                  <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? '保存中...' : '保存模型'}
                  </Button>
                </div>
                {status && <div className="text-xs text-muted-foreground">{status}</div>}
              </>
            )}
          </div>
        </div>
      )}

      {/* 模型列表 */}
      {!editorOpen && (
        <div className="space-y-2">
          {/* 内置组 */}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm font-medium"
            onClick={() => setBuiltinExpanded((v) => !v)}
          >
            {builtinExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            内置
          </button>
          {builtinExpanded && (
            <div className="rounded-lg border">
              {presets
                .filter((p) => p.id === BUILTIN_MODEL.id)
                .map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <Box className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{p.label}</span>
                    <span className="text-xs text-muted-foreground">{providerLabel(p.baseURL)}</span>
                    <button
                      type="button"
                      title="编辑"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => startEdit(p)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <Toggle
                      on={p.id === activePresetId}
                      title={p.id === activePresetId ? '当前使用中' : p.apiKey ? '切换到此模型' : '需先填写 API Key'}
                      onClick={() => void handleSwitch(p)}
                    />
                  </div>
                ))}
            </div>
          )}

          {/* 自定义组 */}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm font-medium"
            onClick={() => setCustomExpanded((v) => !v)}
          >
            {customExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            自定义
          </button>
          {customExpanded && (
            <div className="rounded-lg border">
              {presets.filter((p) => p.id !== BUILTIN_MODEL.id).length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  暂无自定义模型，点击「添加模型」
                </div>
              ) : (
                presets
                  .filter((p) => p.id !== BUILTIN_MODEL.id)
                  .map((p) => (
                    <div key={p.id} className="flex items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0">
                      <Box className="size-4 shrink-0 text-muted-foreground" />
                      <span className={`min-w-0 flex-1 truncate ${p.id === activePresetId ? 'font-medium' : ''}`}>
                        {p.label}
                      </span>
                      <span className="max-w-40 truncate text-xs text-muted-foreground">
                        {providerLabel(p.baseURL)}
                      </span>
                      <button
                        type="button"
                        title="编辑"
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => startEdit(p)}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                        onClick={() => void handleDelete(p.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                      <Toggle
                        on={p.id === activePresetId}
                        title={p.id === activePresetId ? '当前使用中' : '切换到此模型'}
                        onClick={() => void handleSwitch(p)}
                      />
                    </div>
                  ))
              )}
            </div>
          )}

          {status && <div className="text-xs text-muted-foreground">{status}</div>}
        </div>
      )}
    </div>
  )
}
