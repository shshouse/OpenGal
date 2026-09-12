import type { ChatMessage, MessageContentPart } from '@shared/types'
import type { UserInputMessage } from '@shared/messages'
import { useChatStore } from '@/features/chat/chatStore'
import { useCharacterStore } from '@/features/character/characterStore'
import { useLogsStore } from '@/features/logs/logsStore'

const SILENCE_WINDOW_MS = 2500
const MIN_CHARS = 2
const MAX_BUFFER_WAIT_MS = 8000
const SHOT_TTL_MS = 10000
const BACKLOG_TTL_MS = 120000
const MAX_WAIT_ROUNDS = 2

interface Utterance {
  text: string
  at: number
}

interface DirectorDecisionLog {
  utterances: Utterance[]
  joined: string
  decision: 'respond' | 'silence' | 'wait' | 'skip'
  reason?: string
  skipWhy?: 'cooldown' | 'short' | 'busy'
  llmLatencyMs?: number
  screenIncluded?: boolean
  engine?: string
  waitRound?: number
  waitSec?: number
}

let buffer: Utterance[] = []
let backlog: Utterance[] = []
let silenceTimer: ReturnType<typeof setTimeout> | null = null
let waitTimer: ReturnType<typeof setTimeout> | null = null
let waitRound = 0
let waitUtterances: Utterance[] = []
let lastReplyAt = 0
let evaluatingSince = 0
const EVALUATE_LATCH_TTL_MS = 180_000
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
      ...(entry.waitRound !== undefined ? { waitRound: entry.waitRound } : {}),
      ...(entry.waitSec !== undefined ? { waitSec: entry.waitSec } : {}),
      llmLatencyMs: entry.llmLatencyMs ?? 0,
      screenIncluded: entry.screenIncluded ?? false,
      engine: entry.engine ?? ''
    })
  } catch { /* 日志失败不影响主流程 */ }
}

function clearWaitState(): void {
  if (waitTimer) {
    clearTimeout(waitTimer)
    waitTimer = null
  }
  waitRound = 0
  waitUtterances = []
}

function pruneBacklog(): void {
  const cutoff = Date.now() - BACKLOG_TTL_MS
  backlog = backlog.filter((u) => u.at >= cutoff)
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
  // 看门狗：闩锁带 TTL，防止上游 Promise 永不 settle 导致永久锁死
  if (evaluatingSince && Date.now() - evaluatingSince < EVALUATE_LATCH_TTL_MS) return
  if (buffer.length === 0) return
  evaluatingSince = Date.now()
  try {
    const utterances = buffer
    buffer = []
    clearWaitState()
    const cfg = (await window.opengal.config.get()).data?.asr
    if (!cfg) return

    const joined = utterances.map((u) => u.text).join(' ')
    const compact = joined.replace(/[\s，。？！,.?！]/g, '')

    // 游戏模式：冷却加倍，减少打扰
    let cooldownSec = cfg.directorCooldownSec
    try {
      const env = await window.opengal.env.get()
      if (env.success && env.data?.game) cooldownSec = Math.round(cooldownSec * 2)
    } catch {
      /* 环境信息可选 */
    }

    if (cooldownSec > 0 && Date.now() - lastReplyAt < cooldownSec * 1000) {
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

    pruneBacklog()
    const startedAt = Date.now()
    const { decision, screenIncluded } = await askDirector(utterances, backlog, cfg.directorScreenContext)
    const llmLatencyMs = Date.now() - startedAt
    if (decision.action === 'respond') {
      lastReplyAt = Date.now()
      const fullText = [...backlog, ...utterances].map((u) => u.text).join(' ')
      backlog = []
      dispatch?.({ text: fullText, source: 'voice' })
      log('info', `导演放行: ${decision.reason}`)
      decisionLog({
        utterances, joined: fullText, decision: 'respond', reason: decision.reason,
        llmLatencyMs, screenIncluded, engine: cfg.engine
      })
    } else if (decision.action === 'wait') {
      const waitSec = Math.min(Math.max(decision.waitSec ?? 5, 2), 15)
      if (waitRound < MAX_WAIT_ROUNDS) {
        waitRound++
        waitUtterances = utterances
        waitTimer = setTimeout(() => {
          buffer = [...waitUtterances, ...buffer]
          clearWaitState()
          void evaluate()
        }, waitSec * 1000)
        log('info', `导演等待 ${waitSec}s (第${waitRound}轮): ${decision.reason}`)
        decisionLog({
          utterances, joined, decision: 'wait', reason: decision.reason,
          llmLatencyMs, screenIncluded, engine: cfg.engine, waitRound, waitSec
        })
      } else {
        backlog = [...backlog, ...utterances]
        log('info', `等待轮次耗尽，转入回溯池: ${decision.reason}`)
        decisionLog({
          utterances, joined, decision: 'silence', reason: `等待耗尽: ${decision.reason}`,
          llmLatencyMs, screenIncluded, engine: cfg.engine
        })
      }
    } else {
      backlog = [...backlog, ...utterances]
      log('info', `导演沉默: ${decision.reason}`)
      decisionLog({
        utterances, joined, decision: 'silence', reason: decision.reason,
        llmLatencyMs, screenIncluded, engine: cfg.engine
      })
    }
  } catch (err) {
    log('warn', `导演判定失败，保持沉默: ${(err as Error).message}`)
  } finally {
    evaluatingSince = 0
    if (buffer.length > 0) {
      void evaluate()
    }
  }
}

interface DirectorDecision {
  action: 'respond' | 'wait' | 'silence'
  reason: string
  waitSec?: number
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
  backlogUtterances: Utterance[],
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

  const backlogTranscript = backlogUtterances
    .map((u) => `- ${Math.max(1, Math.round((Date.now() - u.at) / 1000))}秒前: "${u.text}"`)
    .join('\n')

  const report = [
    `【当前时间】${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`,
    `【距上次角色回应】${sinceLastReply < 0 ? '本次会话尚未回应过' : `${sinceLastReply}秒前`}`,
    '',
    '【麦克风刚听到的语音】',
    transcript,
    ...(backlogUtterances.length > 0
      ? ['', '【此前被沉默的语音】', backlogTranscript]
      : []),
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
  const parsed = JSON.parse(m[0]) as { action?: string; reason?: string; waitSec?: number }
  const action = parsed.action === 'wait' ? 'wait' : parsed.action === 'respond' ? 'respond' : 'silence'
  return {
    action,
    reason: String(parsed.reason ?? ''),
    ...(parsed.waitSec !== undefined ? { waitSec: Number(parsed.waitSec) } : {})
  }
}

function buildDirectorPrompt(roleName: string | null): string {
  const nameRule = roleName ? `\n- 用户叫角色名字（${roleName}）=> action="respond"` : ''
  return `你是"导演"，为一个桌面虚拟角色工作。你的唯一职责：判断角色【此刻】是否应该回应麦克风听到的话。

你不是角色，不创作任何对话内容。你是一个节奏控制者，目标是让角色显得"有分寸"——该说话时说话，不该说话时安静，话没说完时等待。

判定原则：${nameRule}
- 用户在跟角色说话（提问、打招呼、叫角色名字、情绪表达、明显期待回应）=> action="respond"
- 用户在自言自语、工作口述、打电话、跟别人语音、念稿、读字幕 => action="silence"
- 用户话没说完（句子不完整、明显在组织语言、刚说了半句）=> action="wait"，并给出建议等待秒数 waitSec（2~15）
- 转写是疑问句或以角色名开头 => 大概率 action="respond"
- 依据屏幕内容辅助判断：用户在打字、看视频、游戏中激战 => 倾向 action="silence"；用户停下看着屏幕发呆、在浏览与角色相关内容 => 可以放宽
- 判断模糊时 => action="silence"（安静永远比打扰安全）

只输出一个 JSON 对象，不要输出任何其他内容：
{"action": "respond"|"wait"|"silence", "reason": "简短中文原因", "waitSec": 数字（仅 action="wait" 时需要）}`
}
