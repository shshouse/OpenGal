import * as React from 'react'
import { FolderPlus, Package, Plus, Store } from 'lucide-react'
import type { DiscoveredModSummary } from '@core/mods/manifest'
import type { RoleCardEntry, RoleMode } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useRoleStore } from '@/features/role/roleStore'

interface Props {
  onRoleCreated: (role: RoleCardEntry) => void
  onOpenWorkshop: () => void
  onOpenMarket: () => void
}

const CAPABILITY_LABELS: Record<string, string> = {
  'role-template': '角色模板',
  appearance: '外观装扮',
  voice: '专属音色',
  'tts-engine': '语音合成引擎',
  'asr-engine': '语音识别引擎',
  skill: '扩展技能',
  channel: '外部通道',
}

export function RoleCreatorPanel({
  onRoleCreated,
  onOpenWorkshop,
  onOpenMarket,
}: Props): React.JSX.Element {
  const [templates, setTemplates] = React.useState<RoleCardEntry[]>([])
  const [mods, setMods] = React.useState<Array<DiscoveredModSummary & { rootPath: string }>>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')

  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)
  const [instanceName, setInstanceName] = React.useState('')
  const [instanceMode, setInstanceMode] = React.useState<RoleMode>('agent')
  const [creatingFromTpl, setCreatingFromTpl] = React.useState(false)

  const [blankName, setBlankName] = React.useState('')
  const [blankLanguage, setBlankLanguage] = React.useState('zh')
  const [blankMode, setBlankMode] = React.useState<RoleMode>('agent')
  const [blankGreeting, setBlankGreeting] = React.useState('')
  const [blankDescription, setBlankDescription] = React.useState('')
  const [blankPersonality, setBlankPersonality] = React.useState('')
  const [creatingBlank, setCreatingBlank] = React.useState(false)

  const loadSources = React.useCallback(async () => {
    setLoading(true)
    setError('')
    const [tplRes, modRes] = await Promise.all([
      window.opengal.role.templates(),
      window.opengal.mods.list(),
    ])
    if (tplRes.success && tplRes.data) {
      setTemplates(tplRes.data)
      setSelectedTemplateId((prev) => prev ?? tplRes.data?.[0]?.id ?? null)
    } else {
      setError(tplRes.error ?? '加载模组模板失败')
    }
    if (modRes.success && modRes.data) {
      setMods(modRes.data)
    }
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void loadSources()
  }, [loadSources])

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null

  async function handleCreateFromTemplate(): Promise<void> {
    if (!selectedTemplate) return
    setCreatingFromTpl(true)
    setError('')
    try {
      const res = await window.opengal.role.createCopy(
        selectedTemplate.id,
        instanceName.trim() || undefined,
        instanceMode,
      )
      if (!res.success || !res.data) {
        setError(res.error ?? '创建角色失败')
        return
      }
      await useRoleStore.getState().loadRoles(res.data.id)
      setInstanceName('')
      onRoleCreated(res.data)
    } finally {
      setCreatingFromTpl(false)
    }
  }

  async function handleCreateBlank(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!blankName.trim() || !blankDescription.trim() || !blankPersonality.trim()) return
    setCreatingBlank(true)
    setError('')
    try {
      const res = await window.opengal.role.createBlank({
        name: blankName.trim(),
        displayName: blankName.trim(),
        language: blankLanguage.trim() || 'zh',
        mode: blankMode,
        greeting: blankGreeting.trim() || undefined,
        persona: {
          description: blankDescription.trim(),
          personality: blankPersonality.trim(),
        },
      })
      if (!res.success || !res.data) {
        setError(res.error ?? '创建角色失败')
        return
      }
      await useRoleStore.getState().loadRoles(res.data.id)
      onRoleCreated(res.data)
    } finally {
      setCreatingBlank(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-[840px] flex-col gap-8 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">创建角色</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              每个角色都会在本地独立保存人设、记忆、图片与状态，后续卸载模组也不受影响。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onOpenWorkshop}>
              <FolderPlus className="size-3.5" />
              打开模组工坊
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onOpenMarket}>
              <Store className="size-3.5" />
              前往角色市场
            </Button>
          </div>
        </header>

        {error ? (
          <div role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">从模组模板创建</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              已识别 {templates.length} 个角色模板
            </span>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="h-24 rounded-lg border bg-card/60" />
              <div className="h-24 rounded-lg border bg-card/60" />
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-4">
              <p className="text-sm text-muted-foreground">
                mods 目录下暂无角色模板，可从角色市场获取或在下方直接空白创建。
              </p>
              <Button type="button" variant="outline" size="sm" onClick={onOpenMarket}>
                浏览角色市场
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {templates.map((tpl) => {
                  const selected = tpl.id === selectedTemplateId
                  const title = tpl.displayName ?? tpl.name
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={cn(
                        'flex flex-col items-start gap-1.5 rounded-lg border p-3.5 text-left transition-colors',
                        selected
                          ? 'border-brand bg-brand/10'
                          : 'bg-card hover:bg-accent/50',
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{title}</span>
                        {tpl.language ? (
                          <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                            {tpl.language}
                          </span>
                        ) : null}
                      </div>
                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {tpl.describe?.summary ?? tpl.persona.description}
                      </p>
                    </button>
                  )
                })}
              </div>

              {selectedTemplate ? (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
                  <div className="min-w-[200px] flex-1">
                    <label className="mb-1.5 block text-xs font-medium">角色名称（留空沿用模板名）</label>
                    <Input
                      value={instanceName}
                      onChange={(e) => setInstanceName(e.target.value)}
                      placeholder={selectedTemplate.displayName ?? selectedTemplate.name}
                    />
                  </div>
                  <div>
                    <span className="mb-1.5 block text-xs font-medium">初始运行模式</span>
                    <div className="flex rounded-md border bg-background p-0.5">
                      <button
                        type="button"
                        onClick={() => setInstanceMode('agent')}
                        className={cn(
                          'rounded px-3 py-1 text-xs font-medium transition-colors',
                          instanceMode === 'agent'
                            ? 'bg-brand text-brand-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Agent 伴随
                      </button>
                      <button
                        type="button"
                        onClick={() => setInstanceMode('life')}
                        className={cn(
                          'rounded px-3 py-1 text-xs font-medium transition-colors',
                          instanceMode === 'life'
                            ? 'bg-brand text-brand-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        Life 自主生活
                      </button>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => void handleCreateFromTemplate()}
                    disabled={creatingFromTpl}
                  >
                    <Plus className="size-4" />
                    {creatingFromTpl ? '创建中…' : '创建独立角色'}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="flex flex-col gap-4 border-t pt-6">
          <div>
            <h2 className="text-sm font-semibold">从零创建自定义角色</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              无需准备模组文件，填好设定即可唤醒；立绘与参考音频可随时在工坊补充。
            </p>
          </div>

          <form onSubmit={(e) => void handleCreateBlank(e)} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium">角色名称 *</label>
                <Input
                  required
                  value={blankName}
                  onChange={(e) => setBlankName(e.target.value)}
                  placeholder="例如：小春"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium">说话语言</label>
                <Input
                  value={blankLanguage}
                  onChange={(e) => setBlankLanguage(e.target.value)}
                  placeholder="zh / ja / en"
                />
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-medium">运行模式</span>
                <div className="flex h-9 items-center rounded-md border bg-card p-0.5">
                  <button
                    type="button"
                    onClick={() => setBlankMode('agent')}
                    className={cn(
                      'h-full flex-1 rounded text-xs font-medium transition-colors',
                      blankMode === 'agent'
                        ? 'bg-brand text-brand-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Agent
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlankMode('life')}
                    className={cn(
                      'h-full flex-1 rounded text-xs font-medium transition-colors',
                      blankMode === 'life'
                        ? 'bg-brand text-brand-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Life
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium">身份与背景设定 *</label>
              <Textarea
                required
                rows={3}
                value={blankDescription}
                onChange={(e) => setBlankDescription(e.target.value)}
                placeholder="她的身份、来历与日常习惯"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium">性格与说话方式 *</label>
                <Textarea
                  required
                  rows={3}
                  value={blankPersonality}
                  onChange={(e) => setBlankPersonality(e.target.value)}
                  placeholder="说话节奏、口癖、情绪表达特点"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium">初次见面问候语</label>
                <Textarea
                  rows={3}
                  value={blankGreeting}
                  onChange={(e) => setBlankGreeting(e.target.value)}
                  placeholder="可选，用于锚定第一句话的语气"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={
                  creatingBlank ||
                  !blankName.trim() ||
                  !blankDescription.trim() ||
                  !blankPersonality.trim()
                }
              >
                <Plus className="size-4" />
                {creatingBlank ? '创建中…' : '创建并唤醒角色'}
              </Button>
            </div>
          </form>
        </section>

        {mods.length > 0 ? (
          <section className="flex flex-col gap-3 border-t pt-6">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">mods 目录自动识别清单</h2>
              <span className="text-xs text-muted-foreground tabular-nums">({mods.length})</span>
            </div>
            <div className="divide-y rounded-lg border bg-card">
              {mods.map((mod) => (
                <div key={mod.rootPath} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{mod.displayName || mod.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{mod.folderName}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {mod.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="rounded border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {CAPABILITY_LABELS[cap] ?? cap}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
