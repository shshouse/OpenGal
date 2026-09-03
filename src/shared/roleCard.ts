import type { LLMDialogueItem, RoleCard } from './types'

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

export function buildSystemPrompt(card: RoleCard, motionGroups: string[] = []): string {
  const persona = card.persona
  const userIdentity = persona.userIdentity ?? '用户'
  const userTerm = persona.userTerm ?? card.name
  const lines: string[] = []
  lines.push(`你正在扮演角色：${card.displayName ?? card.name}。`)
  lines.push(`角色设定：${persona.description}`)
  lines.push(`性格：${persona.personality}`)
  if (persona.scenario) lines.push(`场景：${persona.scenario}`)
  if (persona.rules) lines.push(`规则：${persona.rules}`)
  lines.push(`用户身份：${userIdentity}；用户对你的称呼：${userTerm}。`)
  lines.push('')
  lines.push('说话风格（应用级规则，对所有角色生效，优先于角色设定中的书面化表达）：')
  lines.push('- 台词必须写成自然的口语，像面对面说话；不要书面语、公文腔和括号注释。')
  lines.push('- 允许适度使用语气词与停顿（如「嗯……」「哈啊」「那个……」），每条 segment 会被逐句合成语音，真实的呼吸感能让语气更活。')
  lines.push('- 短句优先，一句一个呼吸；情绪放 emotion 字段、肢体动作放 action 字段，都不要写进 text。')
  lines.push('')
  lines.push('输出格式（必须严格遵守，否则解析会失败）：')
  lines.push('每次回复必须是一个合法的 JSON 对象，结构如下：')
  lines.push('{')
  lines.push('  "segments": [')
  lines.push('    { "text": "一句台词", "emotion": "对应情绪", "action": "可选的动作组名" },')
  lines.push('    { "text": "下一句台词", "emotion": "对应情绪" }')
  lines.push('  ]')
  lines.push('}')
  lines.push('')
  lines.push('要求：')
  lines.push('- 每条 segment 是一句独立台词或一段语气连贯的小段，便于逐句播放语音。')
  lines.push('- segments 数组必须包含至少 2 条；遇到很短的回复也要拆成 2 条（如「嗯。」+「怎么了？」）。')
  lines.push(`- emotion 必须从以下集合中取一个：${STANDARD_EMOTIONS.join(', ')}；不确定就用 "neutral"。`)
  if (motionGroups.length > 0) {
    lines.push('- action 是可选的肢体动作：在情绪强烈的句子上填一个，让人物动起来更生动；平淡的过渡句可以不填。必须从下面"可用动作"里挑一个组名。')
    lines.push('- emotion 管面部表情，action 管身体动作，两者可以搭配使用（如 emotion=happy 同时 action=kaixin）。')
  } else {
    lines.push('- 不要输出 action 字段。')
  }
  lines.push('- 不要输出 JSON 以外的任何字符（包括 Markdown 代码块、解释性文字、问候语）。')
  if (motionGroups.length > 0) {
    lines.push('')
    lines.push('可用动作（action 只能从这里选，逐条是「组名：含义」）：')
    lines.push(...formatMotionMenu(motionGroups))
  }
  lines.push('')
  lines.push('EXAMPLE INPUT:')
  lines.push('你好呀！')
  lines.push('')
  lines.push('EXAMPLE JSON OUTPUT:')
  if (motionGroups.length > 0) {
    const exampleAction =
      motionGroups.find((g) => !/^(idle|talk|click)$/i.test(g)) ?? motionGroups[0]
    lines.push('{')
    lines.push('  "segments": [')
    lines.push(`    { "text": "嗨～", "emotion": "happy", "action": "${exampleAction}" },`)
    lines.push('    { "text": "你今天看起来心情不错呢。", "emotion": "happy" },')
    lines.push('    { "text": "想聊点什么？", "emotion": "neutral" }')
    lines.push('  ]')
    lines.push('}')
  } else {
    lines.push('{')
    lines.push('  "segments": [')
    lines.push('    { "text": "嗨～", "emotion": "happy" },')
    lines.push('    { "text": "你今天看起来心情不错呢。", "emotion": "happy" },')
    lines.push('    { "text": "想聊点什么？", "emotion": "neutral" }')
    lines.push('  ]')
    lines.push('}')
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
  if (segs.length === 0) return content
  return segs.map((s) => s.text).join('')
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
  const startIdx = text.search(/[\[{]/)
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
