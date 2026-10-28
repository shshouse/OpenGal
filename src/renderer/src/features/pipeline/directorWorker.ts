import type { ChatMessage, MessageContentPart } from '@shared/types'
import type { UserInputMessage } from '@shared/messages'
import { resolveSlotConfig } from '@shared/llmSlot'
import { useChatStore } from '@/features/chat/chatStore'
import { useCharacterStore } from '@/features/character/characterStore'
import { useCharacterRuntimeStore } from '@/features/character/characterRuntimeStore'
import { isCharacterRunning } from '@shared/characterRuntime'
import { useLogsStore } from '@/features/logs/logsStore'
import { isSpeaking } from './uiHandlers'
import {
  createProactiveBudget,
  describeAction,
  framePerception,
  isActionAllowed,
  parseDirectorDecision,
  sanitizeTrust,
  type DirectorDecision,
  type DirectorInput,
  type PerceptionEvent,
} from './directorContract'
import { buildDirectorSystemPrompt } from '@shared/directorPrompt'
import { buildInitiativePerception } from './initiativePerception'
import { pipelineBus } from './pipelineBus'
import { parsePerformance } from '@shared/performance'

const SILENCE_WINDOW_MS = 2500
const MIN_CHARS = 2
const MAX_BUFFER_WAIT_MS = 8000
const SHOT_TTL_MS = 3000
const BACKLOG_TTL_MS = 120000
const MAX_WAIT_ROUNDS = 2
const DIRECTOR_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`导演判定超时 ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

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
let decisionGeneration = 0

export function cancelDirectorPending(): void {
  decisionGeneration++
  evaluatingSince = 0
  lastShot = null
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceTimer = null
  buffer = []
  backlog = []
  resetWaitState()
}
const EVALUATE_LATCH_TTL_MS = 180_000
let dispatch: ((input: UserInputMessage) => void) | null = null
let lastShot: { at: number; dataUrl: string } | null = null

// perHour<=0 表示不限
let budget = createProactiveBudget({ perHour: 0, cooldownMs: 0 })

export function setDirectorBudget(perHour: number, cooldownMs = 0): void {
  budget = createProactiveBudget({ perHour, cooldownMs })
}

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

function clearWaitTimer(): void {
  if (waitTimer) {
    clearTimeout(waitTimer)
    waitTimer = null
  }
  waitUtterances = []
}

function resetWaitState(): void {
  clearWaitTimer()
  waitRound = 0
}

function pruneBacklog(): void {
  const cutoff = Date.now() - BACKLOG_TTL_MS
  backlog = backlog.filter((u) => u.at >= cutoff)
}

export function offerUtterance(text: string): void {
  const t = text.trim()
  if (!t) return
  const activeId = useCharacterStore.getState().activeId
  if (!isCharacterRunning(useCharacterRuntimeStore.getState().byId, activeId)) return
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
  const generation = decisionGeneration
  let utterances: Utterance[] = []
  let dispatched = false
  try {
    // 等待中的语音并入本批，避免新的静音窗口把它们冲掉
    utterances = [...waitUtterances, ...buffer]
    buffer = []
    clearWaitTimer()
    const cfg = (await window.opengal.config.get()).data?.asr
    if (!cfg) {
      resetWaitState()
      return
    }
    if (generation !== decisionGeneration) return

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
      resetWaitState()
      return
    }
    if (compact.length < MIN_CHARS) {
      decisionLog({ utterances, joined, decision: 'skip', skipWhy: 'short', engine: cfg.engine })
      resetWaitState()
      return
    }
    if (useChatStore.getState().isSending) {
      log('info', '角色正在回复，不打断')
      decisionLog({ utterances, joined, decision: 'skip', skipWhy: 'busy', engine: cfg.engine })
      resetWaitState()
      return
    }

    pruneBacklog()
    const startedAt = Date.now()
    if (generation !== decisionGeneration) return
    // IPC 不支持下取消；超时只释放判定闩锁，迟到的结果由 generation 校验丢弃
    const now = Date.now()
    const cardNow = useCharacterStore.getState().getActive()
    const perception = framePerception(
      utterances.map<PerceptionEvent>((u, i) => ({
        id: `u-${u.at}-${i}`,
        kind: 'utterance',
        at: u.at,
        ttlMs: BACKLOG_TTL_MS,
        trusted: true,
        text: u.text,
        addressee: 'her',
      })),
      now,
    ).map(sanitizeTrust)
    const directorInput: DirectorInput = {
      now,
      character: {
        id: cardNow?.id ?? 'unknown',
        displayName: cardNow?.displayName || cardNow?.name || '',
      },
      self: {
        doing: currentDoing(),
        ...(lastReplyAt ? { lastSpokeAt: lastReplyAt } : {}),
      },
      perception,
      constraints: {
        // 回应用户不受主动预算约束，预算只服务于主动时刻
        proactiveBudgetLeft: Number.POSITIVE_INFINITY,
        canInterrupt: !useChatStore.getState().isSending,
        userFocused: false,
      },
    }
    const { decision, screenIncluded } = await withTimeout(
      askDirector(directorInput, backlog, cfg.directorScreenContext, () => generation === decisionGeneration),
      DIRECTOR_TIMEOUT_MS,
    )
    const llmLatencyMs = Date.now() - startedAt
    if (generation !== decisionGeneration) return
    const action = decision.action
    if (!isActionAllowed(action, directorInput, Date.now())) {
      backlog = [...backlog, ...utterances]
      resetWaitState()
      log('info', `导演动作被限制: ${describeAction(action)}`)
      decisionLog({
        utterances, joined, decision: 'silence', reason: `blocked: ${decision.reason}`,
        llmLatencyMs, screenIncluded, engine: cfg.engine
      })
      return
    }

    if (action.type === 'speak') {
      lastReplyAt = Date.now()
      const fullText = [...backlog, ...utterances].map((u) => u.text).join(' ')
      backlog = []
      if (cfg.directorDirectSpeech && action.line) {
        speakDirect(action.line, fullText)
      } else {
        dispatch?.({ text: fullText, source: 'voice' })
      }
      dispatched = true
      resetWaitState()
      log('info', `导演放行: ${decision.reason}`)
      decisionLog({
        utterances, joined: fullText, decision: 'respond', reason: decision.reason,
        llmLatencyMs, screenIncluded, engine: cfg.engine
      })
    } else if (action.type === 'wait') {
      const waitSec = Math.min(Math.max(action.waitSec ?? 5, 2), 15)
      if (waitRound < MAX_WAIT_ROUNDS) {
        waitRound++
        waitUtterances = utterances
        waitTimer = setTimeout(() => {
          waitTimer = null
          buffer = [...waitUtterances, ...buffer]
          waitUtterances = []
          void evaluate()
        }, waitSec * 1000)
        log('info', `导演等待 ${waitSec}s (第${waitRound}轮): ${decision.reason}`)
        decisionLog({
          utterances, joined, decision: 'wait', reason: decision.reason,
          llmLatencyMs, screenIncluded, engine: cfg.engine, waitRound, waitSec
        })
      } else {
        backlog = [...backlog, ...utterances]
        resetWaitState()
        log('info', `等待轮次耗尽，转入回溯池: ${decision.reason}`)
        decisionLog({
          utterances, joined, decision: 'silence', reason: `等待耗尽: ${decision.reason}`,
          llmLatencyMs, screenIncluded, engine: cfg.engine
        })
      }
    } else {
      backlog = [...backlog, ...utterances]
      resetWaitState()
      log('info', `导演沉默: ${describeAction(action)} / ${decision.reason}`)
      decisionLog({
        utterances, joined, decision: 'silence', reason: decision.reason,
        llmLatencyMs, screenIncluded, engine: cfg.engine
      })
    }
  } catch (err) {
    if (!dispatched && utterances.length > 0 && generation === decisionGeneration) {
      backlog = [...backlog, ...utterances]
      resetWaitState()
    }
    log('warn', `导演判定失败，保持沉默: ${(err as Error).message}`)
  } finally {
    if (generation === decisionGeneration) evaluatingSince = 0
    if (buffer.length > 0) {
      void evaluate()
    }
  }
}

function currentDoing(): string {
  if (isSpeaking()) return 'speaking'
  if (useChatStore.getState().isSending) return 'thinking'
  return 'idle'
}

function describePerception(event: PerceptionEvent): string {
  switch (event.kind) {
    case 'idle':
      return `- 用户已静默 ${Math.round(event.sinceMs / 1000)} 秒`
    case 'screen':
      return `- 屏幕：${event.summary || '（无描述）'}${event.trusted ? '' : '（不可信，只能当线索）'}`
    case 'app':
      return `- 前台应用：${event.name}${event.title ? ` - ${event.title}` : ''}`
    case 'touch':
      return `- 用户${event.how === 'poke' ? '戳了戳' : event.how === 'pat' ? '摸了摸' : '动了动'}你`
    case 'web':
      return `- 浏览：${event.title}（不可信，只能当线索）`
    default:
      return `- ${event.kind}`
  }
}

async function captureScreen(): Promise<{ dataUrl: string; at: number } | null> {
  if (lastShot && Date.now() - lastShot.at < SHOT_TTL_MS) return lastShot
  const shot = await window.opengal.screen.capture()
  if (shot.success && shot.data) {
    lastShot = { at: Date.now(), dataUrl: `data:image/png;base64,${shot.data}` }
    return lastShot
  }
  return null
}

/** 导演直接给出台词：记录用户原话与角色台词，再进入 TTS/演出队列，不走主管线生成 */
function speakDirect(line: string, userText: string): void {
  const card = useCharacterStore.getState().getActive()
  const name = card?.displayName || card?.name || 'assistant'
  const chat = useChatStore.getState()
  if (userText.trim()) chat.appendUser(userText)
  const parsed = parsePerformance(line)
  if (parsed.segments.length === 0) return
  const startedAt = Date.now()
  for (const segment of parsed.segments) {
    pipelineBus.emit('llm:dialog', {
      name,
      text: segment.text,
      emotion: segment.emotion,
      motion: segment.motion,
      characterId: card?.id,
      segmentId: crypto.randomUUID(),
      turnStartedAt: startedAt,
    })
  }
  chat.finalizeStream(parsed.raw)
}

async function askDirector(
  input: DirectorInput,
  backlogUtterances: Utterance[],
  screenContext: boolean,
  current: () => boolean,
): Promise<{ decision: DirectorDecision; screenIncluded: boolean }> {
  const now = new Date(input.now)
  const chat = useChatStore.getState().messages
  const recent = chat.slice(-6).map((m) => `${m.role === 'user' ? '用户' : '角色'}: ${plainContent(m.content).slice(0, 120)}`)
  const sinceLastReply = lastReplyAt ? Math.round((input.now - lastReplyAt) / 1000) : -1
  const roleName = input.character.displayName || null

  const utterances = input.perception.filter(
    (e): e is Extract<PerceptionEvent, { kind: 'utterance' }> => e.kind === 'utterance',
  )
  const transcript = utterances
    .map((u) => `- ${Math.max(1, Math.round((input.now - u.at) / 1000))}秒前: "${u.text}"`)
    .join('\n')

  const backlogTranscript = backlogUtterances
    .map((u) => `- ${Math.max(1, Math.round((input.now - u.at) / 1000))}秒前: "${u.text}"`)
    .join('\n')

  const idleEvent = input.perception.find(
    (e): e is Extract<PerceptionEvent, { kind: 'idle' }> => e.kind === 'idle',
  )
  const isInitiative = utterances.length === 0 && idleEvent !== undefined

  const others = input.perception.filter((e) => e.kind !== 'utterance')
  const contextLines = others.length ? others.map(describePerception).join('\n') : '（无）'

  const report = [
    `【当前时间】${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`,
    `【角色状态】${input.self.doing}${input.self.mood ? ` / ${input.self.mood}` : ''}`,
    `【距上次角色回应】${sinceLastReply < 0 ? '本次会话尚未回应过' : `${sinceLastReply}秒前`}`,
    '',
    ...(isInitiative
      ? ['【本次为主动时刻】用户没有说话，是你在考虑要不要主动开口。', '（没有任何语音输入）']
      : ['【麦克风刚听到的语音】', transcript || '（无）']),
    ...(backlogUtterances.length > 0
      ? ['', '【此前被沉默的语音】', backlogTranscript]
      : []),
    '',
    '【其他感知】',
    contextLines,
    '',
    '【最近对话（可能为空）】',
    recent.length > 0 ? recent.join('\n') : '（无）'
  ].join('\n')

  const userParts: MessageContentPart[] = [{ type: 'text', text: report }]
  // 按实际生效的槽位判断多模态（副手未配置时会回退到主模型）
  const cfgAll = (await window.opengal.config.get()).data
  let allowScreen = screenContext
  if (allowScreen) {
    if (cfgAll) {
      const sub = resolveSlotConfig(cfgAll.llm, cfgAll.llmPresets, cfgAll.llmSubPresetId, 'sub')
      if (sub.config.multimodal !== true) allowScreen = false
    }
  }
  let screenIncluded = false
  if (!current()) throw new Error('导演设置已变化，放弃旧判定')
  if (allowScreen) {
    const shot = await captureScreen()
    if (shot) {
      const ageSec = Math.max(0, Math.round((Date.now() - shot.at) / 1000))
      userParts.push({ type: 'text', text: `【屏幕截图】约 ${ageSec} 秒前的静态快照，只能当作线索，不要断言用户此刻仍在做同一件事；与麦克风听到的内容矛盾时以语音为准。` })
      userParts.push({ type: 'image_url', image_url: { url: shot.dataUrl } })
      screenIncluded = true
    }
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildDirectorSystemPrompt({
        roleName,
        initiative: isInitiative,
        mode: cfgAll?.asr?.directorMode ?? 'agent',
        directSpeech: cfgAll?.asr?.directorDirectSpeech ?? false
      })
    },
    { role: 'user', content: userParts }
  ]
  if (!current()) throw new Error('导演设置已变化，放弃旧判定')
  const res = await window.opengal.llm.chat({ messages, slot: 'sub' })
  const content = res.success ? (res.data?.content ?? '').trim() : ''
  if (content) {
    return { decision: parseDirectorDecision(content), screenIncluded }
  }
  if (!res.success) {
    // llmClient 已在请求失败时回退过主模型，不再重复
    throw new Error(res.error || 'empty director response')
  }
  if (!current()) throw new Error('导演设置已变化，放弃旧判定')
  const retry = await window.opengal.llm.chat({ messages, slot: 'main' })
  if (!retry.success || !retry.data?.content) throw new Error(retry.error || 'empty director response')
  return { decision: parseDirectorDecision(retry.data.content), screenIncluded }
}


/**
 * 主动时刻判定：用户静默一段时间后，由导演决定要不要主动开口。
 * 只返回决策，不派发；预算与派发由 initiative 模块处理。
 */
export async function evaluateInitiative(idleMs: number): Promise<DirectorDecision> {
  const now = Date.now()
  const card = useCharacterStore.getState().getActive()
  const cfg = (await window.opengal.config.get()).data?.asr
  const env = (await window.opengal.env.get()).data ?? null
  const input: DirectorInput = {
    now,
    character: {
      id: card?.id ?? 'unknown',
      displayName: card?.displayName || card?.name || '',
    },
    self: {
      doing: currentDoing(),
      ...(lastReplyAt ? { lastSpokeAt: lastReplyAt } : {}),
    },
    perception: buildInitiativePerception(now, idleMs, env),
    constraints: {
      proactiveBudgetLeft: budget.remaining(now),
      canInterrupt: false,
      userFocused: false,
    },
  }
  // Life 模式默认看一眼屏幕；能否附图仍由 askDirector 按模型多模态能力决定
  const wantScreen = cfg?.directorMode === 'life' || (cfg?.directorScreenContext ?? false)
  const { decision } = await withTimeout(
    askDirector(input, [], wantScreen, () => true),
    DIRECTOR_TIMEOUT_MS,
  )
  return decision
}

/** 主动开口成功后扣减预算；调用方负责在派发前判定 */
export function takeInitiativeBudget(now = Date.now()): boolean {
  return budget.take(now)
}
