import type { LLMDialogueItem, RoleCard } from './types'
import { speechLanguageLabel } from './subtitles'

export const STANDARD_EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'shy',
  'proud',
  'thinking',
  'sleepy',
  'relaxed',
  'excited',
  'worried',
] as const

const MOTION_GROUP_LABELS: Record<string, string> = {
  Idle: '待机、平静（一般无需主动触发）',
  talk: '说话时的自然肢体摆动',
  click: '一个随机的小动作（被点到时的反应）',
  kaixin: '开心',
  shengqi: '生气',
  nanguo: '难过',
  haixiu: '害羞',
  chijing: '吃惊',
  bizui: '抿嘴、沉默',
  happy: '开心',
  angry: '生气',
  sad: '难过',
  shy: '害羞',
  surprised: '吃惊',
}

function formatMotionMenu(motionGroups: string[]): string[] {
  return motionGroups
    .filter((g) => g !== 'Idle')
    .map((g) => `- "${g}"：${MOTION_GROUP_LABELS[g] ?? g}`)
}

export function buildSystemPrompt(
  card: RoleCard,
  motionGroups: string[] = [],
  memoryBlock?: string,
  hasTools = false,
  emotions: readonly string[] = STANDARD_EMOTIONS,
): string {
  const persona = card.persona
  const userIdentity = persona.userIdentity ?? '用户'
  const userTerm = persona.userTerm ?? '朋友'
  const lines: string[] = []
  lines.push(`你正在扮演角色：${card.displayName ?? card.name}。`)
  lines.push('你生活在 OpenGal 这个 Harness 里，知道它是你运行、感知和使用工具的环境；OpenGal 不额外决定你的身份、经历或你与用户的关系。')
  lines.push('关系与称呼只以角色设定和用户明确表达为准；未明确时，与用户保持平等的朋友关系，不自行添加主从、雇佣或侍奉设定。')
  lines.push(`角色设定：${persona.description}`)
  lines.push(`性格：${persona.personality}`)
  if (card.language) {
    lines.push(`角色的台词必须使用 ${card.language} 语言，不随用户输入语言改变；只输出角色原文，不附翻译。下面的示例仅演示标签格式，示例语言不能覆盖此规则。`)
    const label = speechLanguageLabel(card.language)
    // 只写语言代码时模型经常忽略（启动问候尤其明显），补一行明确的可读名称
    if (label) lines.push(`说话语言固定为${label}：系统提示、问候语、用户输入即使是别的语言，台词也必须用${label}。`)
  }
  if (persona.scenario) lines.push(`场景：${persona.scenario}`)
  if (persona.rules) lines.push(`规则：${persona.rules}`)
  lines.push(`用户身份：${userIdentity}；你称呼用户为：${userTerm}。`)
  if (memoryBlock) {
    lines.push('')
    lines.push(memoryBlock)
  }
  lines.push('')
  lines.push('说话风格（应用级规则，对所有角色生效，优先于角色设定中的书面化表达）：')
  lines.push('- 台词必须写成自然的口语，像面对面说话；不要书面语、公文腔和括号注释。')
  lines.push('- 允许适度使用语气词与停顿（如「嗯……」「哈啊」「那个……」），台词会被分段合成语音，真实的呼吸感能让语气更活。')
  lines.push('- 短句优先，一句一个呼吸；情绪和动作都用行内标签表示，不要写进台词。')
  lines.push('')
  lines.push('输出格式（必须严格遵守，否则解析会失败）：')
  lines.push('- 直接输出台词，不要 JSON、不要 Markdown、不要解释性文字。')
  if (emotions.length > 0) {
    lines.push(`- 在需要换表情的位置写 <e:表情>；表情只能从以下集合中取一个：${emotions.join(', ')}；不确定就用 neutral。`)
  } else {
    lines.push('- 不要输出 <e:...> 表情标签（当前皮套没有可用表情）。')
  }
  if (motionGroups.length > 0) {
    lines.push('- 在需要触发肢体动作的位置写 <a:动作组>；动作组只能从下面的可用动作里选。动作触发一次后失效。')
  } else {
    lines.push('- 不要输出 <a:...> 动作标签。')
  }
  lines.push('- 标签放在逗号、句号等自然停顿处；每句最多 2-3 个标签；不要输出未知标签。')
  lines.push('- 第一段尽量短（6-12 字），让语音尽快开始；后面的句子再展开。')
  lines.push('- 标签本身不要读出来，只作为表演指令。')
  if (hasTools) {
    lines.push('')
    lines.push('工具使用规则（重要）：')
    lines.push('- 你可以调用工具（如联网搜索、查文件、截屏）。需要工具时，必须在本轮回复中直接发起工具调用。')
    lines.push('- 一旦你输出台词，本轮就结束了，之后你没有任何机会再行动。禁止在台词里说「让我查一下」「稍等」却不发起工具调用。')
    lines.push('- 正确做法：先发起工具调用（此时可以不输出台词），拿到工具结果后再生成带结果的台词。')
  }
  if (motionGroups.length > 0) {
    lines.push('')
    lines.push('可用动作（<a:...> 只能从这里选，逐条是「组名：含义」）：')
    lines.push(...formatMotionMenu(motionGroups))
  }
  lines.push('')
  const emotionOpen = emotions.length > 0 ? '<e:happy>' : ''
  const emotionReset = emotions.length > 0 ? '<e:neutral>' : ''
  lines.push('EXAMPLE INPUT:')
  lines.push('你好呀！')
  lines.push('')
  lines.push('EXAMPLE OUTPUT:')
  if (motionGroups.length > 0) {
    const exampleAction =
      motionGroups.find((g) => !/^(idle|talk|click)$/i.test(g)) ?? motionGroups[0]
    lines.push(`${emotionOpen}<a:${exampleAction}>嗨～${emotionReset}你今天看起来心情不错呢。想聊点什么？`)
  } else {
    lines.push(`${emotionOpen}嗨～${emotionReset}你今天看起来心情不错呢。想聊点什么？`)
  }
  return lines.join('\n')
}

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
        this.applyTag('a', inlineAction[1])
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
          this.applyTag(tag[1], tag[2])
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
      const forceCut = pendingTag ? pendingTag[1].toLowerCase() === 'e' : false
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
    if (re.test(text[i])) return i
  }
  return -1
}

function lastIndexMatch(text: string, re: RegExp): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (re.test(text[i])) return i
  }
  return -1
}

// 只剥离行内表演标签，句中的字面小于号（如 <3）必须原样保留
function stripSpeechTags(text: string): string {
  return text.replace(/<\s*[ea]\s*:\s*[^<>]*?\s*>/gi, '').replace(/<\s*[ea]\s*:\s*[^<>]*$/i, '')
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
  return match ? match[1].trim() : text
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
