import * as React from 'react'
import { RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { RoleCard, RoleCardEditableFields, RoleCardEntry } from '@shared/types'

interface Draft {
  displayName: string
  color: string
  language: string
  persona: {
    description: string
    personality: string
    scenario: string
    rules: string
    userIdentity: string
    userTerm: string
  }
}

function toDraft(role: RoleCard): Draft {
  return {
    displayName: role.displayName ?? '',
    color: role.color ?? '',
    language: role.language ?? '',
    persona: {
      description: role.persona.description,
      personality: role.persona.personality,
      scenario: role.persona.scenario ?? '',
      rules: role.persona.rules ?? '',
      userIdentity: role.persona.userIdentity ?? '',
      userTerm: role.persona.userTerm ?? '',
    },
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-xs leading-relaxed text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function PersonaPanel({
  role,
  onSaved,
}: {
  role: RoleCardEntry
  onSaved: (card: RoleCard) => void
}): React.JSX.Element {
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(role))
  const [baseline, setBaseline] = React.useState(() => JSON.stringify(toDraft(role)))
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState('')

  const dirty = JSON.stringify(draft) !== baseline
  const colorValid = !draft.color || /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(draft.color)
  const canSave = !role.builtin && dirty && colorValid && !saving

  function patchPersona(patch: Partial<Draft['persona']>): void {
    setDraft((current) => ({ ...current, persona: { ...current.persona, ...patch } }))
    setNotice('')
  }

  function patchIdentity(patch: Partial<Pick<Draft, 'displayName' | 'color' | 'language'>>): void {
    setDraft((current) => ({ ...current, ...patch }))
    setNotice('')
  }

  function reset(): void {
    setDraft(JSON.parse(baseline) as Draft)
    setError(null)
    setNotice('')
  }

  async function save(): Promise<void> {
    if (!draft.persona.description.trim() || !draft.persona.personality.trim()) {
      setError('角色描述和性格不能为空')
      return
    }
    const fields: RoleCardEditableFields = {
      displayName: draft.displayName,
      color: draft.color,
      language: draft.language,
      persona: {
        description: draft.persona.description,
        personality: draft.persona.personality,
        scenario: draft.persona.scenario,
        rules: draft.persona.rules,
        userIdentity: draft.persona.userIdentity,
        userTerm: draft.persona.userTerm,
      },
    }

    setSaving(true)
    setError(null)
    setNotice('')
    try {
      const response = await window.opengal.role.saveCard(role.id, fields)
      if (!response.success || !response.data) {
        setError(response.error ?? '保存失败')
        return
      }
      const next = toDraft(response.data.card)
      setDraft(next)
      setBaseline(JSON.stringify(next))
      setNotice('已保存')
      onSaved(response.data.card)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="显示名" hint="留空时使用角色原名。">
          <Input
            value={draft.displayName}
            maxLength={64}
            onChange={(event) => patchIdentity({ displayName: event.target.value })}
            placeholder={role.name}
            disabled={role.builtin}
          />
        </Field>
        <Field label="说话语言" hint="填 zh、ja、en 等语言代码；留空则跟随用户。">
          <Input
            value={draft.language}
            maxLength={64}
            onChange={(event) => patchIdentity({ language: event.target.value })}
            placeholder="ja"
            disabled={role.builtin}
          />
        </Field>
      </div>

      <Field label="主题色" hint="用于角色列表和标题栏的识别色，填 #RGB 或 #RRGGBB。">
        <div className="flex items-center gap-2">
          <span
            className="size-8 shrink-0 rounded-md border bg-background"
            style={draft.color ? { backgroundColor: draft.color } : undefined}
            aria-hidden
          />
          <Input
            value={draft.color}
            maxLength={7}
            onChange={(event) => patchIdentity({ color: event.target.value })}
            placeholder="#33C1E6"
            className="max-w-40 font-mono"
            disabled={role.builtin}
            aria-invalid={!colorValid}
          />
          {!colorValid ? <span className="text-xs text-destructive">颜色格式不正确</span> : null}
        </div>
      </Field>

      <Field label="角色描述" hint="她是谁、和用户处在什么关系里。改动从下一句对话开始生效。">
        <Textarea
          value={draft.persona.description}
          maxLength={20_000}
          onChange={(event) => patchPersona({ description: event.target.value })}
          rows={4}
          disabled={role.builtin}
        />
      </Field>

      <Field label="性格" hint="说话方式、情绪表达和判断习惯。">
        <Textarea
          value={draft.persona.personality}
          maxLength={20_000}
          onChange={(event) => patchPersona({ personality: event.target.value })}
          rows={4}
          disabled={role.builtin}
        />
      </Field>

      <Field label="场景" hint="默认发生的场合；留空则不限定。">
        <Textarea
          value={draft.persona.scenario}
          maxLength={20_000}
          onChange={(event) => patchPersona({ scenario: event.target.value })}
          rows={3}
          disabled={role.builtin}
        />
      </Field>

      <Field label="规则" hint="必须遵守或避免的行为，会写进每一轮对话。">
        <Textarea
          value={draft.persona.rules}
          maxLength={20_000}
          onChange={(event) => patchPersona({ rules: event.target.value })}
          rows={5}
          disabled={role.builtin}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="用户身份" hint="角色如何看待你。">
          <Input
            value={draft.persona.userIdentity}
            maxLength={2_000}
            onChange={(event) => patchPersona({ userIdentity: event.target.value })}
            placeholder="朋友"
            disabled={role.builtin}
          />
        </Field>
        <Field label="称呼" hint="角色叫你什么。">
          <Input
            value={draft.persona.userTerm}
            maxLength={200}
            onChange={(event) => patchPersona({ userTerm: event.target.value })}
            placeholder="你"
            disabled={role.builtin}
          />
        </Field>
      </div>

      <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center gap-3 border-t bg-background px-6 py-3">
        <Button type="button" onClick={() => void save()} disabled={!canSave}>
          <Save className="size-3.5" />
          {saving ? '保存中…' : '保存设定'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={reset}
          disabled={!dirty || saving}
        >
          <RotateCcw className="size-3.5" />
          撤销修改
        </Button>
        {notice ? <span className="text-xs text-muted-foreground">{notice}</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  )
}
