import type { LLMDialogueItem } from './llm'

export class DialogueStreamParser {
  private buffer = ''

  feed(chunk: string): LLMDialogueItem[] {
    if (chunk) this.buffer += chunk
    return this.drainComplete()
  }

  flush(): LLMDialogueItem[] {
    const items = this.drainComplete()
    const remaining = this.buffer.trim()
    this.buffer = ''
    if (!remaining) return items

    const parsed =
      tryParseJson(remaining) ??
      tryParseJson(stripMarkdownFence(remaining)) ??
      tryParseJson(extractJsonSubstring(remaining))
    if (parsed) items.push(...extractSegments(parsed))
    return items
  }

  reset(): void {
    this.buffer = ''
  }

  private drainComplete(): LLMDialogueItem[] {
    const items: LLMDialogueItem[] = []
    while (true) {
      const endIdx = findClosingBrace(this.buffer)
      if (endIdx === -1) break
      const startIdx = this.buffer.lastIndexOf('{', endIdx)
      if (startIdx === -1) {
        this.buffer = this.buffer.slice(endIdx + 1)
        continue
      }
      const slice = this.buffer.slice(startIdx, endIdx + 1)
      try {
        const parsed = JSON.parse(slice) as unknown
        if (isDialogueItem(parsed)) {
          items.push(parsed as LLMDialogueItem)
        }
        this.buffer = this.buffer.slice(endIdx + 1)
      } catch {
        this.buffer = this.buffer.slice(endIdx + 1)
      }
    }
    return items
  }
}

const SPEECH_TAG_RE = /^<\s*([ea])\s*:\s*([^<>]*?)\s*>/i
const SENTENCE_END_RE = /[。！？!?；;\n]/
const COMMA_RE = /[，,、]/
const FIRST_CHUNK_MAX = 12
const NEXT_CHUNK_MAX = 40

// 行内标签协议：标签即表情/动作切换点，也是 TTS 分段点
export class SpeechStreamParser {
  private buffer = ''
  private mode: 'unknown' | 'tagged' | 'json' = 'unknown'
  private jsonParser = new DialogueStreamParser()
  private emotion = 'neutral'
  private action: string | undefined
  private firstChunk = true

  feed(chunk: string): LLMDialogueItem[] {
    if (chunk) this.buffer += chunk
    if (this.mode === 'unknown') this.detectMode()
    if (this.mode === 'json') {
      const pending = this.buffer
      this.buffer = ''
      return this.jsonParser.feed(pending)
    }
    return this.mode === 'tagged' ? this.drainTagged(false) : []
  }

  flush(): LLMDialogueItem[] {
    if (this.mode === 'unknown') this.detectMode()
    if (this.mode === 'json') {
      const pending = this.buffer
      this.buffer = ''
      return [...this.jsonParser.feed(pending), ...this.jsonParser.flush()]
    }
    const items = this.mode === 'tagged' ? this.drainTagged(true) : []
    const rest = stripSpeechTags(this.buffer).trim()
    this.buffer = ''
    if (rest) {
      const item = this.makeItem(rest)
      if (item) items.push(item)
    }
    return items
  }

  reset(): void {
    this.buffer = ''
    this.mode = 'unknown'
    this.jsonParser.reset()
    this.emotion = 'neutral'
    this.action = undefined
    this.firstChunk = true
  }

  private detectMode(): void {
    const trimmed = this.buffer.trimStart()
    if (!trimmed) return
    const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '')
    this.mode = unfenced.startsWith('{') || unfenced.startsWith('[') ? 'json' : 'tagged'
  }

  private drainTagged(final: boolean): LLMDialogueItem[] {
    const items: LLMDialogueItem[] = []
    while (this.buffer.length > 0) {
      const lt = this.buffer.indexOf('<')
      const rest = lt === -1 ? '' : this.buffer.slice(lt)
      // 动作标签不切段：就地记下动作，文本继续累积到句子边界
      const inlineAction = lt !== -1 ? /^<\s*a\s*:\s*([^<>]*?)\s*>/i.exec(rest) : null
      if (inlineAction) {
        const before = this.buffer.slice(0, lt)
        // 动作落在两句之间时归到后一句：前一句已经说完，不能让它在说完之后才执行
        if (before.trim() && SENTENCE_END_RE.test(before.trim().slice(-1))) {
          const item = this.makeItem(before)
          if (item) items.push(item)
          this.buffer = this.buffer.slice(lt)
          continue
        }
        this.applyTag('a', inlineAction[1] ?? '')
        this.buffer = this.buffer.slice(0, lt) + this.buffer.slice(lt + inlineAction[0].length)
        continue
      }
      const literalLt = /^<\s*\d/.test(rest)
      const textEnd = lt === -1 || literalLt ? this.buffer.length : lt
      const text = this.buffer.slice(0, textEnd)

      if (text.length === 0) {
        if (lt === -1) break
        const gt = this.buffer.indexOf('>', lt)
        if (gt === -1) break
        const tag = SPEECH_TAG_RE.exec(this.buffer)
        if (tag) {
          this.applyTag(tag[1] ?? '', tag[2] ?? '')
          this.buffer = this.buffer.slice(tag[0].length)
        } else {
          this.buffer = this.buffer.slice(gt + 1)
        }
        continue
      }

      if (!text.trim()) {
        this.buffer = this.buffer.slice(textEnd)
        continue
      }

      // 只有表情标签强制切段；动作标签随句子一起切，避免多一次 TTS 合成
      const pendingTag = rest ? SPEECH_TAG_RE.exec(rest) : null
      const forceCut = pendingTag?.[1]?.toLowerCase() === 'e'
      const cut = this.findCut(text, final, forceCut)
      if (cut <= 0) break
      const item = this.makeItem(text.slice(0, cut))
      if (item) items.push(item)
      this.buffer = this.buffer.slice(cut)
    }
    return items
  }

  private findCut(text: string, final: boolean, force: boolean): number {
    const max = this.firstChunk ? FIRST_CHUNK_MAX : NEXT_CHUNK_MAX
    if (this.firstChunk) {
      const window = text.slice(0, Math.min(text.length, max))
      const sentence = firstIndexMatch(window, SENTENCE_END_RE)
      const comma = firstIndexMatch(window, COMMA_RE)
      let cut = sentence >= 0 ? sentence + 1 : -1
      if (comma >= 3 && (cut < 0 || comma + 1 < cut)) cut = comma + 1
      if (cut > 0) return cut
      if (text.length >= max) return max
      return force || final ? text.length : 0
    }
    if (text.length > max) {
      const window = text.slice(0, max)
      const sentence = lastIndexMatch(window, SENTENCE_END_RE)
      if (sentence >= 0) return sentence + 1
      return max
    }
    if (force || final) {
      const sentence = lastIndexMatch(text, SENTENCE_END_RE)
      if (sentence >= 0) return sentence + 1
      return text.length
    }
    const sentence = firstIndexMatch(text, SENTENCE_END_RE)
    if (sentence >= 0) return sentence + 1
    return 0
  }

  private applyTag(kind: string, raw: string): void {
    const value = raw.trim()
    if (!value) return
    if (kind.toLowerCase() === 'e') {
      this.emotion = value
    } else {
      this.action = value
    }
  }

  private makeItem(raw: string): LLMDialogueItem | null {
    const text = stripSpeechTags(raw).trim()
    if (!text) return null
    const item: LLMDialogueItem = { text, emotion: this.emotion }
    if (this.action) {
      item.action = this.action
      this.action = undefined
    }
    this.firstChunk = false
    return item
  }
}

function firstIndexMatch(text: string, re: RegExp): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== undefined && re.test(ch)) return i
  }
  return -1
}

function lastIndexMatch(text: string, re: RegExp): number {
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch !== undefined && re.test(ch)) return i
  }
  return -1
}

// 只剥离行内表演标签，句中的字面小于号（如 <3）必须原样保留
function stripSpeechTags(text: string): string {
  return text
    .replace(/<\s*[ea]\s*:\s*[^<>]*?\s*>/gi, '')
    .replace(/<\s*[ea]\s*:\s*[^<>]*$/i, '')
    // 模型偶尔会吐出 <|AUDIO_START|> 这类特殊 token；不剥离会原样进台词和 TTS
    .replace(/<\|[^|<>]*\|>/g, '')
    .replace(/<\|[^|<>]*$/g, '')
}

function findClosingBrace(s: string): number {
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') {
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (!inString && c === '}') return i
  }
  return -1
}

export function extractAssistantDisplayText(content: string): string {
  const t = content.trim()
  if (!t) return ''
  const parsed = tryParseJson(t) ?? tryParseJson(stripMarkdownFence(t)) ?? tryParseJson(extractJsonSubstring(t))
  const segs = parsed ? extractSegments(parsed) : salvageSegments(t)
  if (segs.length > 0) return segs.map((s) => s.text).join('')
  return stripSpeechTags(t).trim()
}

function salvageSegments(text: string): LLMDialogueItem[] {
  const items: LLMDialogueItem[] = []
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    const parsed = tryParseJson(m[0])
    if (isDialogueItem(parsed)) items.push(parsed as unknown as LLMDialogueItem)
  }
  return items
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function stripMarkdownFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return match?.[1]?.trim() ?? text
}

function extractJsonSubstring(text: string): string {
  const startIdx = text.search(/[[{]/)
  if (startIdx === -1) return text
  const opener = text[startIdx]
  const closer = opener === '{' ? '}' : ']'
  const endIdx = text.lastIndexOf(closer)
  if (endIdx <= startIdx) return text
  return text.slice(startIdx, endIdx + 1)
}

function extractSegments(parsed: unknown): LLMDialogueItem[] {
  if (!parsed || typeof parsed !== 'object') return []
  const obj = parsed as Record<string, unknown>
  if (Array.isArray(obj.segments)) {
    return (obj.segments as unknown[]).filter(isDialogueItem) as LLMDialogueItem[]
  }
  if (Array.isArray(obj.dialog)) {
    return (obj.dialog as unknown[]).filter(isDialogueItem) as LLMDialogueItem[]
  }
  if (Array.isArray(parsed)) {
    return (parsed as unknown[]).filter(isDialogueItem) as LLMDialogueItem[]
  }
  if (isDialogueItem(obj)) return [obj as unknown as LLMDialogueItem]
  return []
}

function isDialogueItem(v: unknown): boolean {
  return !!v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string'
}

export interface PerformanceSegment {
  text: string
  emotion?: string
  motion?: string
}

export interface ParsedPerformance {
  /** 原始输出，含行内表演标记；用于落库与下一轮历史 */
  raw: string
  /** 去掉标记后给用户看的文本 */
  displayText: string
  /** 送进 TTS 的文本，不含任何表演标记 */
  ttsText: string
  /** 皮套消费的片段与动作 */
  segments: PerformanceSegment[]
}

/**
 * 完整台词的四种视图：原文 / 展示 / 语音 / 皮套。
 * 流式生成用 SpeechStreamParser.feed，完整文本用这里；另起一套解析前先看能否复用。
 */
export function parsePerformance(raw: string): ParsedPerformance {
  const parser = new SpeechStreamParser()
  const items = [...parser.feed(raw), ...parser.flush()]
  const text = items.map((item) => item.text).join('')
  return {
    raw,
    displayText: text,
    ttsText: text,
    segments: items.map((item) => ({
      text: item.text,
      emotion: item.emotion,
      motion: item.action,
    })),
  }
}
