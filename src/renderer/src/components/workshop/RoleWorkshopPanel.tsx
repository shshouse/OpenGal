import * as React from 'react'
import { ExternalLink, FolderOutput, ImagePlus, Mic, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { AssetProvenanceKind, WorkshopDraft } from '@core/workshop/types'
import type { RoleCardEntry, RoleExampleTurn, RoleMode } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useRoleStore } from '@/features/role/roleStore'

interface Props {
  onPreviewPortraitChange: (dataUrl: string | null) => void
  onRoleFinalized: (role: RoleCardEntry) => void
}

const LF = String.fromCharCode(10)
const DOUBLE_LF_RE = new RegExp(`${LF}\\s*${LF}`)

function parseExampleLines(raw: string): RoleExampleTurn[] {
  const blocks = raw
    .replace(/\r\n/g, LF)
    .split(DOUBLE_LF_RE)
    .map((b) => b.trim())
    .filter(Boolean)
  const out: RoleExampleTurn[] = []
  for (const block of blocks) {
    const lines = block.split(LF).map((l) => l.trim())
    const u = lines[0]?.replace(/^(?:用户|对方|Q)[:：]\s*/, '') ?? ''
    const a = lines.slice(1).join(' ').replace(/^(?:角色|台词|A)[:：]\s*/, '')
    if (u && a) out.push({ user: u, assistant: a })
  }
  return out
}

function formatExampleLines(examples: RoleExampleTurn[]): string {
  return examples
    .map((item) => `对方：${item.user}${LF}台词：${item.assistant}`)
    .join(`${LF}${LF}`)
}

export function RoleWorkshopPanel({
  onPreviewPortraitChange,
  onRoleFinalized,
}: Props): React.JSX.Element {
  const [drafts, setDrafts] = React.useState<WorkshopDraft[]>([])
  const [activeDraftId, setActiveDraftId] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [language, setLanguage] = React.useState('zh')
  const [mode, setMode] = React.useState<RoleMode>('agent')
  const [greeting, setGreeting] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [personality, setPersonality] = React.useState('')
  const [scenario, setScenario] = React.useState('')
  const [rules, setRules] = React.useState('')
  const [examplesText, setExamplesText] = React.useState('')

  const [voiceEngine, setVoiceEngine] = React.useState<'none' | 'fish' | 'gpt-sovits' | 'genie'>('none')
  const [fishReferenceId, setFishReferenceId] = React.useState('')
  const [referenceText, setReferenceText] = React.useState('')
  const [referenceAudioRel, setReferenceAudioRel] = React.useState('')

  const [provenanceKind, setProvenanceKind] = React.useState<AssetProvenanceKind>('local-personal')
  const [license, setLicense] = React.useState('')
  const [credits, setCredits] = React.useState('')

  const [saving, setSaving] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const [error, setError] = React.useState('')

  const applyDraftToForm = React.useCallback(
    async (draft: WorkshopDraft) => {
      setActiveDraftId(draft.draftId)
      setName(draft.name)
      setDisplayName(draft.displayName)
      setLanguage(draft.language)
      setMode(draft.mode)
      setGreeting(draft.greeting)
      setDescription(draft.persona.description)
      setPersonality(draft.persona.personality)
      setScenario(draft.persona.scenario ?? '')
      setRules(draft.persona.rules ?? '')
      setExamplesText(formatExampleLines(draft.examples))
      setVoiceEngine(draft.voice.engine)
      setFishReferenceId(draft.voice.fishReferenceId ?? '')
      setReferenceText(draft.voice.referenceText ?? '')
      setReferenceAudioRel(draft.voice.referenceAudioRelPath ?? '')
      setProvenanceKind(draft.provenance.kind)
      setLicense(draft.provenance.license)
      setCredits(draft.provenance.credits)

      const preview = await window.opengal.workshop.portraitPreview(draft.draftId)
      onPreviewPortraitChange(preview.success ? (preview.data ?? null) : null)
    },
    [onPreviewPortraitChange],
  )

  const loadDraftList = React.useCallback(async () => {
    const res = await window.opengal.workshop.list()
    if (res.success && res.data) {
      setDrafts(res.data)
      if (!activeDraftId && res.data[0]) {
        void applyDraftToForm(res.data[0])
      }
    }
  }, [activeDraftId, applyDraftToForm])

  React.useEffect(() => {
    void loadDraftList()
    const off = window.opengal.workshop.onUpdated((updated) => {
      setDrafts((prev) => {
        const rest = prev.filter((d) => d.draftId !== updated.draftId)
        return [updated, ...rest]
      })
      void applyDraftToForm(updated)
      setNotice(`已载入角色协助整理的草稿「${updated.displayName}」`)
    })
    return () => {
      off()
      onPreviewPortraitChange(null)
    }
  }, [applyDraftToForm, loadDraftList, onPreviewPortraitChange])

  function startNewDraft(): void {
    setActiveDraftId(null)
    setName('')
    setDisplayName('')
    setLanguage('zh')
    setMode('agent')
    setGreeting('')
    setDescription('')
    setPersonality('')
    setScenario('')
    setRules('')
    setExamplesText('')
    setVoiceEngine('none')
    setFishReferenceId('')
    setReferenceText('')
    setReferenceAudioRel('')
    setProvenanceKind('local-personal')
    setLicense('')
    setCredits('')
    setNotice('')
    setError('')
    onPreviewPortraitChange(null)
  }

  async function saveCurrentDraft(): Promise<WorkshopDraft | null> {
    if (!name.trim() || !description.trim() || !personality.trim()) {
      setError('请先填写短名、身份背景与性格设定')
      return null
    }
    setSaving(true)
    setError('')
    try {
      const res = await window.opengal.workshop.save({
        draftId: activeDraftId ?? undefined,
        name: name.trim(),
        displayName: displayName.trim() || name.trim(),
        language: language.trim() || 'zh',
        mode,
        greeting: greeting.trim(),
        examples: parseExampleLines(examplesText),
        persona: {
          description: description.trim(),
          personality: personality.trim(),
          ...(scenario.trim() ? { scenario: scenario.trim() } : {}),
          ...(rules.trim() ? { rules: rules.trim() } : {}),
        },
        voice: {
          engine: voiceEngine,
          fishReferenceId: fishReferenceId.trim() || undefined,
          referenceText: referenceText.trim() || undefined,
          referenceAudioRelPath: referenceAudioRel || undefined,
          language: language.trim() || 'zh',
        },
        provenance: {
          kind: provenanceKind,
          license: license.trim(),
          credits: credits.trim(),
        },
      })
      if (!res.success || !res.data) {
        setError(res.error ?? '草稿保存失败')
        return null
      }
      await applyDraftToForm(res.data)
      setNotice('草稿已保存，左侧舞台已更新预览')
      return res.data
    } finally {
      setSaving(false)
    }
  }

  async function handlePickAsset(kind: 'portrait' | 'voice'): Promise<void> {
    const saved = activeDraftId ? { draftId: activeDraftId } : await saveCurrentDraft()
    if (!saved) return
    const res = await window.opengal.workshop.pickAsset(saved.draftId, kind)
    if (!res.success) {
      setError(res.error ?? '导入素材失败')
      return
    }
    if (res.data) {
      await applyDraftToForm(res.data)
      setNotice(kind === 'portrait' ? '立绘已更新' : '参考音频样本已导入')
    }
  }

  async function handleFinalizeRole(): Promise<void> {
    const saved = await saveCurrentDraft()
    if (!saved) return
    const res = await window.opengal.workshop.finalizeRole(saved.draftId)
    if (!res.success || !res.data) {
      setError(res.error ?? '生成角色失败')
      return
    }
    await useRoleStore.getState().loadRoles(res.data.id)
    onRoleFinalized(res.data)
  }

  async function handleExportMod(): Promise<void> {
    const saved = await saveCurrentDraft()
    if (!saved) return
    const res = await window.opengal.workshop.exportMod(saved.draftId)
    if (!res.success) {
      setError(res.error ?? '导出模组包失败')
      return
    }
    if (res.data) {
      setNotice(`模组包已导出至：${res.data.modPath}`)
    }
  }

  async function handlePublishMikuMod(): Promise<void> {
    const saved = await saveCurrentDraft()
    if (!saved) return
    const res = await window.opengal.workshop.publishMikuMod(saved.draftId)
    if (!res.success) {
      setError(res.error ?? '无法发起 MikuMod 发布')
      return
    }
    if (res.data) {
      setNotice(`已在资源管理器定位模组目录并打开 MikuMod 发布页：${res.data.modPath}`)
    }
  }

  async function handleDeleteDraft(): Promise<void> {
    if (!activeDraftId) return
    await window.opengal.workshop.delete(activeDraftId)
    startNewDraft()
    await loadDraftList()
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-[840px] flex-col gap-6 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">角色模组工坊</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              手动制作角色包，或在对话页直接让当前唤醒的角色帮你搜集设定、台词与立绘，成果会实时出现在这里。
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={startNewDraft}>
            <Plus className="size-3.5" />
            新建草稿
          </Button>
        </header>

        {drafts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {drafts.map((d) => (
              <button
                key={d.draftId}
                type="button"
                onClick={() => void applyDraftToForm(d)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                  d.draftId === activeDraftId
                    ? 'border-brand bg-brand/10 text-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {d.displayName || d.name}
              </button>
            ))}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
            {notice}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium">英文/拼音标识 *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 furina" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium">显示名称</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="如 芙宁娜"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium">台词语言</label>
            <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="zh / ja / en" />
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-medium">默认模式</span>
            <div className="flex h-9 items-center rounded-md border bg-card p-0.5">
              <button
                type="button"
                onClick={() => setMode('agent')}
                className={cn(
                  'h-full flex-1 rounded text-xs font-medium transition-colors',
                  mode === 'agent' ? 'bg-brand text-brand-foreground' : 'text-muted-foreground',
                )}
              >
                Agent
              </button>
              <button
                type="button"
                onClick={() => setMode('life')}
                className={cn(
                  'h-full flex-1 rounded text-xs font-medium transition-colors',
                  mode === 'life' ? 'bg-brand text-brand-foreground' : 'text-muted-foreground',
                )}
              >
                Life
              </button>
            </div>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
          <div className="min-w-[200px] flex-1">
            <h2 className="text-sm font-medium">立绘与零样本音色素材</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              无需本地训练环境，提供 10-30 秒干净角色原声片段与对应台词，即可直接用零样本克隆发声。
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void handlePickAsset('portrait')}>
            <ImagePlus className="size-3.5" />
            选择立绘图片
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handlePickAsset('voice')}>
            <Mic className="size-3.5" />
            {referenceAudioRel ? '更换参考音频' : '选择参考音频'}
          </Button>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium">语音方案</label>
            <select
              value={voiceEngine}
              onChange={(e) => setVoiceEngine(e.target.value as typeof voiceEngine)}
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              <option value="none">暂不配置专属音色</option>
              <option value="fish">Fish Audio 云端音色</option>
              <option value="gpt-sovits">GPT-SoVITS 零样本参考音频</option>
              <option value="genie">Genie 本地音色</option>
            </select>
          </div>
          {voiceEngine === 'fish' ? (
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium">Fish Audio 音色 ID</label>
              <Input
                value={fishReferenceId}
                onChange={(e) => setFishReferenceId(e.target.value)}
                placeholder="粘贴 Fish Audio 模型 ID"
              />
            </div>
          ) : voiceEngine !== 'none' ? (
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium">参考音频原文台词</label>
              <Input
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
                placeholder="填写与参考音频完全一致的台词文本"
              />
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium">身份与背景设定 *</label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="角色的经历、身份、世界观背景"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium">性格与口癖 *</label>
              <Textarea
                rows={3}
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                placeholder="说话方式、情绪反应、句式特点"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">场景与规则（可选）</label>
              <Textarea
                rows={3}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="例如：不用感叹号、只说日语等"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium">初次见面问候语</label>
            <Input
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="第一次唤醒时对用户说的话"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium">
              原声语感示范台词（每组两行：第一行写对方的话，第二行写角色台词，空行分隔多组）
            </label>
            <Textarea
              rows={5}
              value={examplesText}
              onChange={(e) => setExamplesText(e.target.value)}
              placeholder={`对方：今天好累${LF}台词：先去洗把脸休息十分钟，剩下的事晚点再说。`}
            />
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t pt-5">
          <h2 className="text-sm font-semibold">资产来源与 MikuMod 发布声明</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium">资产性质</label>
              <select
                value={provenanceKind}
                onChange={(e) => setProvenanceKind(e.target.value as AssetProvenanceKind)}
                className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
              >
                <option value="local-personal">仅本地自用（含未授权游戏/声优原素材）</option>
                <option value="recipe-only">仅发布人设与台词配方（不含原始版权素材）</option>
                <option value="authorized-derivative">允许二创分发的授权素材</option>
                <option value="original">完全原创资产</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">协议声明（公开导出必填）</label>
              <Input
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                placeholder="如 CC-BY-NC-4.0"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">来源署名（公开导出必填）</label>
              <Input
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                placeholder="立绘、配音与设定原作者署名"
              />
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <div>
            {activeDraftId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleDeleteDraft()}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
                删除草稿
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void saveCurrentDraft()}
              disabled={saving}
            >
              {saving ? '保存中…' : '保存并刷新预览'}
            </Button>
            <Button type="button" size="sm" onClick={() => void handleFinalizeRole()} disabled={saving}>
              <Sparkles className="size-3.5" />
              生成到本地角色
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void handleExportMod()}>
              <FolderOutput className="size-3.5" />
              导出模组包
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void handlePublishMikuMod()}>
              <ExternalLink className="size-3.5" />
              前往 MikuMod 发布
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
