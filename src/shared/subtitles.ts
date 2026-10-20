export interface SubtitleSegment {
  id: string
  text: string
  translation?: string
}

export function languageCode(value: string): string {
  try { return new Intl.Locale(value.trim().replace(/_/g, '-')).language } catch { return '' }
}

export function roleSpeechLanguage(value: string): 'zh' | 'ja' | 'en' | 'ko' | 'yue' {
  const code = languageCode(value)
  if (code === 'zh' || code === 'ja' || code === 'en' || code === 'ko' || code === 'yue') return code
  throw new Error(`当前本地语音引擎不支持角色语言 ${value}；请使用支持该语言的语音模型`)
}

export function subtitleText(segments: SubtitleSegment[], mode: string): string {
  const original = segments.map((s) => s.text).join('')
  if (mode === 'off') return original
  const translated = segments.map((s) => s.translation || s.text).join('')
  if (translated === original) return original
  return mode === 'translated' ? translated : `${original}\n${translated}`
}
