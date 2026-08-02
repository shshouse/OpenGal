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

/**
 * 构造引导 LLM 走 DeepSeek/OpenAI 官方 JSON Mode 的 system prompt。
 *
 * 协议（单一合法 JSON，可被 response_format: json_object 强约束）：
 *   {
 *     "segments": [
 *       { "text": "...", "emotion": "happy" },
 *       { "text": "...", "emotion": "neutral" }
 *     ]
 *   }
 *
 * 之所以不用"多个独立 JSON 对象"协议——那不是合法 JSON，无法被 response_format
 * 强约束，弱模型经常退化成纯文本。包一层 segments 数组后，模型只要保证返回一个
 * 合法 JSON 即可，跟随率接近 100%。
 *
 * 代价：失去边收边吐的逐段流式（要等整个 JSON 收完才能 parse），TTS 必须等一整轮。
 */
export function buildSystemPrompt(card: RoleCard): string {
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
  lines.push('输出格式（必须严格遵守，否则解析会失败）：')
  lines.push('每次回复必须是一个合法的 JSON 对象，结构如下：')
  lines.push('{')
  lines.push('  "segments": [')
  lines.push('    { "text": "一句台词", "emotion": "对应情绪" },')
  lines.push('    { "text": "下一句台词", "emotion": "对应情绪" }')
  lines.push('  ]')
  lines.push('}')
  lines.push('')
  lines.push('要求：')
  lines.push('- 每条 segment 是一句独立台词或一段语气连贯的小段，便于逐句播放语音。')
  lines.push('- segments 数组必须包含至少 2 条；遇到很短的回复也要拆成 2 条（如「嗯。」+「怎么了？」）。')
  lines.push(`- emotion 必须从以下集合中取一个：${STANDARD_EMOTIONS.join(', ')}；不确定就用 "neutral"。`)
  lines.push('- 不要输出 JSON 以外的任何字符（包括 Markdown 代码块、解释性文字、问候语）。')
  lines.push('')
  lines.push('EXAMPLE INPUT:')
  lines.push('你好呀！')
  lines.push('')
  lines.push('EXAMPLE JSON OUTPUT:')
  lines.push('{')
  lines.push('  "segments": [')
  lines.push('    { "text": "嗨～", "emotion": "happy" },')
  lines.push('    { "text": "你今天看起来心情不错呢。", "emotion": "happy" },')
  lines.push('    { "text": "想聊点什么？", "emotion": "neutral" }')
  lines.push('  ]')
  lines.push('}')
  return lines.join('\n')
}

/**
 * 流式 JSON 解析器：贪心扫描 buffer 中能闭合的内层对象，逐个 yield。
 *
 * 对齐 RachelForster `core/messaging/stream_parser.py` 的设计：
 * 外层 `{"segments":[` 暂时无法闭合（没收到末尾 `]}`）→ 跳过；
 * 每个内层 `{"text":"...","emotion":"..."}` 一闭合就被切下来 JSON.parse → yield。
 * 这样既享受 JSON Mode 的强约束（response_format: json_object 保证整体合法），
 * 又能边收边吐每个 dialog item，不必等整段下载完——TTS / UI 可以并行启动。
 *
 * 容错：
 * - parse 失败（如 buffer 还没闭合完、跨边界字符）→ 跳过该 `}`，继续等下一个
 * - 单条 parse 出来但没 text 字段（如 dialog 数组的元数据对象）→ 过滤掉
 * - flush 时整段 buffer 还能 JSON.parse 成功 → 提取 segments / dialog 数组里的项作兜底
 */
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

    // stream 结束时还有残留 buffer：尝试当作完整 JSON 整段 parse（处理只有 1 个对象、
    // markdown 包装、思考前缀 + JSON 等边缘情况）
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
      const endIdx = this.buffer.indexOf('}')
      if (endIdx === -1) break
      const startIdx = this.buffer.lastIndexOf('{', endIdx)
      if (startIdx === -1) {
        // 孤立的 }，丢弃避免死循环
        this.buffer = this.buffer.slice(endIdx + 1)
        continue
      }
      const slice = this.buffer.slice(startIdx, endIdx + 1)
      try {
        const parsed = JSON.parse(slice) as unknown
        if (isDialogueItem(parsed)) {
          items.push(parsed as LLMDialogueItem)
        }
        // 不论是不是 dialogue item，吃掉这段防止无限重扫
        this.buffer = this.buffer.slice(endIdx + 1)
      } catch {
        // 不完整或嵌套未闭合：跳过本 `}` 但保留之后的内容继续扫描
        this.buffer = this.buffer.slice(endIdx + 1)
      }
    }
    return items
  }
}

/**
 * 把存进 messages 的 assistant content（已是合规 JSON 字符串）解析回纯文本，供 UI 渲染。
 *
 * 历史落盘用 raw JSON（见 chatStore.finalizeStream + useChatPipeline 的注释）以兼容
 * DeepSeek JSON Mode 的多轮约定，但 UI 不能直接显示 `{"segments":[...]}`。
 *
 * 容错：部分模型会把思考过程写进 content（而非 reasoning_content 通道），
 * 返回形如 "思考...\n\n{json}"。从首个 `{`/`[` 截取 JSON 子串解析，剥离前缀。
 * 兜底：解析失败（fallback 路径下的纯文本）就原样返回。
 */
export function extractAssistantDisplayText(content: string): string {
  const t = content.trim()
  if (!t) return ''
  const parsed = tryParseJson(t) ?? tryParseJson(stripMarkdownFence(t)) ?? tryParseJson(extractJsonSubstring(t))
  if (!parsed) return content
  const segs = extractSegments(parsed)
  if (segs.length === 0) return content
  return segs.map((s) => s.text).join('')
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

/**
 * 从任意文本中提取 JSON 子串：找到第一个 `{` 或 `[`，截取到与之类型匹配的
 * 最后一个 `}` 或 `]`。用于模型把思考过程写在 JSON 前面的容错场景。
 */
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
