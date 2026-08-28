import type { ChatMessage, MessageContentPart } from '@shared/types'
import type { UserInputMessage } from '@shared/messages'
import { useChatStore } from '@/features/chat/chatStore'
import { useLogsStore } from '@/features/logs/logsStore'

const SILENCE_WINDOW_MS = 2500
const MIN_CHARS = 2

interface Utterance {
  text: string
  at: number
}

let buffer: Utterance[] = []
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let lastReplyAt = 0
let evaluating = false
let dispatch: ((input: UserInputMessage) => void) | null = null

export function setDirectorDispatch(fn: ((input: UserInputMessage) => void) | null): void {
  dispatch = fn
}

function log(level: 'info' | 'warn', message: string): void {
  useLogsStore.getState().appendLocal(level, 'director', message)
}

export function offerUtterance(text: string): void {
  const t = text.trim()
  if (!t) return
  buffer.push({ text: t, at: Date.now() })
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceTimer = setTimeout(() => {
    void evaluate()
  }, SILENCE_WINDOW_MS)
}

function plainContent(content: string | MessageContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .map((p) => (p.type === 'text' ? p.text : '[图片]'))
    .join(' ')
}

async function evaluate(): Promise<void> {
  const utterances = buffer
  buffer = []
  if (utterances.length === 0 || evaluating) return
  evaluating = true
  try {
    const cfg = (await window.opengal.config.get()).data?.asr
    if (!cfg) return

    const joined = utterances.map((u) => u.text).join(' ')
    const compact = joined.replace(/[\s，。？！,.?！]/g, '')

    if (cfg.directorCooldownSec > 0 && Date.now() - lastReplyAt < cfg.directorCooldownSec * 1000) {
      log('info', `冷却中，忽略语音: ${joined.slice(0, 40)}`)
      return
    }
    if (compact.length < MIN_CHARS) return
    if (useChatStore.getState().isSending) {
      log('info', '角色正在回复，不打断')
      return
    }

    const decision = await askDirector(utterances, cfg.directorScreenContext)
    if (decision.respond) {
      lastReplyAt = Date.now()
      dispatch?.({ text: joined, source: 'voice' })
      log('info', `导演放行: ${decision.reason}`)
    } else {
      log('info', `导演沉默: ${decision.reason}`)
    }
  } catch (err) {
    log('warn', `导演判定失败，保持沉默: ${(err as Error).message}`)
  } finally {
    evaluating = false
  }
}

interface DirectorDecision {
  respond: boolean
  reason: string
}

async function askDirector(utterances: Utterance[], screenContext: boolean): Promise<DirectorDecision> {
  const now = new Date()
  const chat = useChatStore.getState().messages
  const recent = chat.slice(-6).map((m) => `${m.role === 'user' ? '用户' : '角色'}: ${plainContent(m.content).slice(0, 120)}`)
  const sinceLastReply = lastReplyAt ? Math.round((Date.now() - lastReplyAt) / 1000) : -1

  const transcript = utterances
    .map((u) => `- ${Math.max(1, Math.round((Date.now() - u.at) / 1000))}秒前: "${u.text}"`)
    .join('\n')

  const report = [
    `【当前时间】${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`,
    `【距上次角色回应】${sinceLastReply < 0 ? '本次会话尚未回应过' : `${sinceLastReply}秒前`}`,
    '',
    '【麦克风听到的语音转写（离线识别，可能不准确）】',
    transcript,
    '',
    '【最近对话（可能为空）】',
    recent.length > 0 ? recent.join('\n') : '（无）'
  ].join('\n')

  const userParts: MessageContentPart[] = [{ type: 'text', text: report }]
  if (screenContext) {
    const shot = await window.opengal.screen.capture()
    if (shot.success && shot.data) {
      userParts.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${shot.data}` } })
    }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: DIRECTOR_PROMPT },
    { role: 'user', content: userParts }
  ]
  const res = await window.opengal.llm.chat({ messages })
  if (!res.success || !res.data?.content) throw new Error(res.error || 'empty director response')
  return parseDecision(res.data.content)
}

function parseDecision(raw: string): DirectorDecision {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error(`无法解析导演输出: ${raw.slice(0, 120)}`)
  const parsed = JSON.parse(m[0]) as DirectorDecision
  if (typeof parsed.respond !== 'boolean') throw new Error('导演输出缺少 respond 字段')
  return { respond: parsed.respond, reason: String(parsed.reason ?? '') }
}

const DIRECTOR_PROMPT = `你是"导演"，为一个桌面虚拟角色工作。你的唯一职责：判断角色【此刻】是否应该回应麦克风听到的话。

你不是角色，不创作任何对话内容。你是一个节奏控制者，目标是让角色显得"有分寸"——该说话时说话，不该说话时安静。

判定原则：
- 用户在跟角色说话（提问、打招呼、叫角色名字、情绪表达、明显期待回应）=> respond=true
- 用户在自言自语、工作口述、打电话、跟别人语音、念稿、读字幕 => respond=false
- 转写是疑问句或以角色名开头 => 大概率 respond=true
- 依据屏幕内容辅助判断：用户在打字、看视频、游戏中激战 => 倾向 respond=false；用户停下看着屏幕发呆、在浏览与角色相关内容 => 可以放宽
- 判断模糊时 => respond=false（安静永远比打扰安全）

只输出一个 JSON 对象，不要输出任何其他内容：
{"respond": true, "reason": "简短中文原因"}`
