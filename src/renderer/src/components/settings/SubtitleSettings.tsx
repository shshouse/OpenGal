import * as React from 'react'
import type { AppConfig } from '@shared/types'
import { languageCode } from '@shared/subtitles'
import { applySubtitleConfig, useSubtitleStore } from '@/features/pipeline/subtitles'

export function SubtitleSettings({ config, onSave }: {
  config: AppConfig | null
  onSave: (patch: Partial<AppConfig>) => Promise<void>
}) {
  const preferences = useSubtitleStore((s) => s.preferences)
  const systemLocale = useSubtitleStore((s) => s.systemLocale)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [target, setTarget] = React.useState(preferences.targetLanguage)
  React.useEffect(() => { if (config) applySubtitleConfig(config) }, [config])
  React.useEffect(() => { setTarget(preferences.targetLanguage) }, [preferences.targetLanguage])
  async function save(mode: typeof preferences.mode, targetLanguage: string): Promise<void> {
    if (targetLanguage !== 'system' && !languageCode(targetLanguage)) { setError('请输入有效的语言代码，例如 zh-CN、en、ja'); return }
    setBusy(true)
    setError('')
    try {
      await onSave({ subtitles: { mode, targetLanguage } })
      if (config) applySubtitleConfig({ ...config, subtitles: { mode, targetLanguage } })
    } catch { setError('字幕设置保存失败') } finally { setBusy(false) }
  }
  return <div className="space-y-3 border-t pt-4">
    <h3 className="text-sm font-semibold">字幕语言</h3>
    <p className="text-xs text-muted-foreground">角色按角色卡语言说话。翻译使用副手模型（未配置时使用主模型），会产生额外 API 用量，不等待译文才开口。</p>
    <label className="flex items-center gap-3 text-sm">显示方式
      <select className="rounded border bg-background p-2" value={preferences.mode} disabled={busy} onChange={(e) => void save(e.target.value as typeof preferences.mode, preferences.targetLanguage)}>
        <option value="off">关闭翻译（显示原文）</option><option value="translated">仅译文</option><option value="bilingual">原文 + 译文</option>
      </select>
    </label>
    <label className="flex items-center gap-3 text-sm">翻译目标
      <input className="rounded border bg-background p-2" aria-label="字幕目标语言" value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)} />
      <button type="button" disabled={busy} onClick={() => void save(preferences.mode, target.trim())}>保存</button>
      <button type="button" disabled={busy} onClick={() => void save(preferences.mode, 'system')}>跟随系统</button>
    </label>
    <p className="text-xs text-muted-foreground">system 表示跟随系统（{systemLocale}）；也可输入 zh-CN、en、ja 等语言代码。译文尚未返回或失败时显示原文。</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}
