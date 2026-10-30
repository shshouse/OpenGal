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

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  yue: '粤语',
}

/** 语言代码的可读名称；提示词里写「en」模型经常不认，补一个中文名 */
export function speechLanguageLabel(value: string): string | null {
  return LANGUAGE_LABELS[languageCode(value)] ?? null
}

/**
 * 台词的主要书写系统。只用于判断「这段文字喂给某个语种的音色模型会不会出问题」，
 * 不做严格语种识别：日文有假名就算 ja，韩文有谚文就算 ko，其余汉字占多算 zh。
 */
export function scriptLanguage(text: string): 'zh' | 'en' | 'ja' | 'ko' | 'none' {
  let han = 0
  let kana = 0
  let hangul = 0
  let latin = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x3040 && code <= 0x30ff) kana += 1
    else if (code >= 0xac00 && code <= 0xd7af) hangul += 1
    else if (code >= 0x4e00 && code <= 0x9fff) han += 1
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1
  }
  if (kana > 0) return 'ja'
  if (hangul > 0) return 'ko'
  if (han === 0 && latin === 0) return 'none'
  return han > latin ? 'zh' : 'en'
}

/**
 * 台词的书写系统能否交给该语种的音色模型。
 * 中文喂给英文 Genie 模型时，模型会直接复读参考音频（实测输出时长只跟参考音长短走），
 * 所以这类不匹配必须拦在合成之前。
 */
export function speechLanguageSupported(modelLanguage: string, text: string): boolean {
  const spoken = scriptLanguage(text)
  if (spoken === 'none' || spoken === 'en') return true
  const model = languageCode(modelLanguage)
  if (model === 'yue') return spoken === 'zh'
  return spoken === model
}

export function subtitleText(segments: SubtitleSegment[], mode: string): string {
  const original = segments.map((s) => s.text).join('')
  if (mode === 'off') return original
  const translated = segments.map((s) => s.translation || s.text).join('')
  if (translated === original) return original
  return mode === 'translated' ? translated : `${original}\n${translated}`
}
