import type { ChatMessage, MessageContentPart } from '@shared/types'
import type { UserInputMessage } from '@shared/messages'
import { useChatStore } from '@/features/chat/chatStore'
import { useCharacterStore } from '@/features/character/characterStore'
import { useLogsStore } from '@/features/logs/logsStore'

const SILENCE_WINDOW_MS = 2500
const MIN_CHARS = 2
const MAX_BUFFER_WAIT_MS = 8000
const SHOT_TTL_MS = 10000

interface Utterance {
  text: string
  at: number
}

interface DirectorDecisionLog {
  utterances: Utterance[]
  joined: string
  decision: 'respond' | 'silence' | 'skip'
  reason?: string
  skipWhy?: 'cooldown' | 'short' | 'busy'
  llmLatencyMs?: number
  screenIncluded?: boolean
  engine?: string
}

let buffer: Utterance[] = []
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let lastReplyAt = 0
let evaluating = false
let dispatch: ((input: UserInputMessage) => void) | null = null
let lastShot: { at: number; dataUrl: string } | null = null

export function setDirectorDispatch(fn: ((input: UserInputMessage) => void) | null): void {
  dispatch = fn
}

function log(level: 'info' | 'warn', message: string): void {
  useLogsStore.getState().appendLocal(level, 'director', message)
}

function decisionLog(entry: DirectorDecisionLog): void {
  const now = Date.now()
  try {
    window.opengal.director.log({
      ts: now,
      utterances: entry.utterances.map((u) => ({
        text: u.text,
        agoSec: Math.max(0, Math.round((now - u.at) / 1000))
      })),
      joined: entry.joined,
      decision: entry.decision,
      reason: entry.reason ?? '',
      ...(entry.skipWhy ? { skipWhy: entry.skipWhy } : {}),
      llmLatencyMs: entry.llmLatencyMs ?? 0,
      screenIncluded: entry.screenIncluded ?? false,
      engine: entry.engine ?? ''
    })
  } catch { /* 日志失败不影响主流程 */ }
}

export function offerUtterance(text: string): void {
  const t = text.trim()
  if (!t) return
  buffer.push({ text: t, at: Date.now() })
  if (silenceTimer) clearTimeout(silenceTimer)
  const wait = Math.min(SILENCE_WINDOW_MS, Math.max(0, buffer[0].at + MAX_BUFFER_WAIT_MS - Date.now()))
  silenceTimer = setTimeout(() => {
    void evaluate()
  }, wait)
}

function plainContent(content: string | MessageContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .map((p) => (p.type === 'text' ? p.text : '[图片]'))
    .join(' ')
}

async function evaluate(): Promise<void> {
  if (evaluating || buffer.length === 0) return
  evaluating = true
  try {
    const utterances = buffer
    buffer = []
    const cfg = (await window.opengal.config.get()).data?.asr
    if (!cfg) return

    const joined = utterances.map((u) => u.text).join(' ')
    const compact = joined.replace(/[\s，。？！,.?！]/g, '')

    if (cfg.directorCooldownSec > 0 && Date.now() - lastReplyAt < cfg.directorCooldownSec * 1000) {
      log('info', `冷却中，忽略语音: ${joined.slice(0, 40)}`)
      decisionLog({ utterances, joined, decision: 'skip', skipWhy: 'cooldown', engine: cfg.engine })
      return
    }
    if (compact.length < MIN_CHARS) {
      decisionLog({ utterances, joined, decision: 'skip', skipWhy: 'short', engine: cfg.engine })
      return
    }
    if (useChatStore.getState().isSending) {
      log('info', '角色正在回复，不打断')
      decisionLog({ utterances, joined, decision: 'skip', skipWhy: 'busy', engine: cfg.engine })
      return
    }

    const startedAt = Date.now()
    const { decision, screenIncluded } = await askDirector(utterances, cfg.directorScreenContext)
    const llmLatencyMs = Date.now() - startedAt
    if (decision.respond) {
      lastReplyAt = Date.now()
      dispatch?.({ text: joined, source: 'voice' })
      log('info', `导演放行: ${decision.reason}`)
      decisionLog({
        utterances, joined, decision: 'respond', reason: decision.reason,
        llmLatencyMs, screenIncluded, engine: cfg.engine
      })
    } else {
      log('info', `导演沉默: ${decision.reason}`)
      decisionLog({
        utterances, joined, decision: 'silence', reason: decision.reason,
        llmLatencyMs, screenIncluded, engine: cfg.engine
      })
    }
  } catch (err) {
    log('warn', `导演判定失败，保持沉默: ${(err as Error).message}`)
  } finally {
    evaluating = false
    if (buffer.length > 0) {
      void evaluate()
    }
  }
}

interface DirectorDecision {
  respond: boolean
  reason: string
}

async function captureScreen(): Promise<string | null> {
  if (lastShot && Date.now() - lastShot.at < SHOT_TTL_MS) return lastShot.dataUrl
  const shot = await window.opengal.screen.capture()
  if (shot.success && shot.data) {
    lastShot = { at: Date.now(), dataUrl: `data:image/png;base64,${shot.data}` }
    return lastShot.dataUrl
  }
  return null
}

async function askDirector(
  utterances: Utterance[],
  screenContext: boolean
): Promise<{ decision: DirectorDecision; screenIncluded: boolean }> {
  const now = new Date()
  const chat = useChatStore.getState().messages
  const recent = chat.slice(-6).map((m) => `${m.role === 'user' ? '用户' : '角色'}: ${plainContent(m.content).slice(0, 120)}`)
  const sinceLastReply = lastReplyAt ? Math.round((Date.now() - lastReplyAt) / 1000) : -1
  const card = useCharacterStore.getState().getActive()
  const roleName = card?.displayName || card?.name || null

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
  let screenIncluded = false
  if (screenContext) {
    const dataUrl = await captureScreen()
    if (dataUrl) {
      userParts.push({ type: 'image_url', image_url: { url: dataUrl } })
      screenIncluded = true
    }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: buildDirectorPrompt(roleName) },
    { role: 'user', content: userParts }
  ]
  const res = await window.opengal.llm.chat({ messages, overrides: card?.llm })
  if (!res.success || !res.data?.content) throw new Error(res.error || 'empty director response')
  return { decision: parseDecision(res.data.content), screenIncluded }
}

function parseDecision(raw: string): DirectorDecision {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error(`无法解析导演输出: ${raw.slice(0, 120)}`)
  const parsed = JSON.parse(m[0]) as DirectorDecision
  if (typeof parsed.respond !== 'boolean') throw new Error('导演输出缺少 respond 字段')
  return { respond: parsed.respond, reason: String(parsed.reason ?? '') }
}

function buildDirectorPrompt(roleName: string | null): string {
  const nameRule = roleName ? `\n- 用户叫角色名字（${roleName}）=> respond=true` : ''
  return `你是"导演"，为一个桌面虚拟角色工作。你的唯一职责：判断角色【此刻】是否应该回应麦克风听到的话。

你不是角色，不创作任何对话内容。你是一个节奏控制者，目标是让角色显得"有分寸"——该说话时说话，不该说话时安静。

判定原则：${nameRule}
- 用户在跟角色说话（提问、打招呼、叫角色名字、情绪表达、明显期待回应）=> respond=true
- 用户在自言自语、工作口述、打电话、跟别人语音、念稿、读字幕 => respond=false
- 转写是疑问句或以角色名开头 => 大概率 respond=true
- 依据屏幕内容辅助判断：用户在打字、看视频、游戏中激战 => 倾向 respond=false；用户停下看着屏幕发呆、在浏览与角色相关内容 => 可以放宽
- 判断模糊时 => respond=false（安静永远比打扰安全）

只输出一个 JSON 对象，不要输出任何其他内容：
{"respond": true, "reason": "简短中文原因"}`
}
