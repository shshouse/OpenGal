import type { LifeLogEntry, RoleStateSnapshot } from '../role/types'

export type LifeAction =
  | { type: 'speak'; line: string }
  | { type: 'write_diary'; title: string; content: string }
  | { type: 'search_interest'; query: string }
  | { type: 'change_outfit'; outfitId: string }
  | { type: 'observe_screen' }
  | { type: 'rest'; reason?: string }

export interface LifeDecision {
  thought: string
  mood: string
  energyDelta: number
  activity: string
  shortTermGoal?: string
  action: LifeAction
  nextTickSec: number
}

export interface LifeTickContext {
  now: number
  roleName: string
  language?: string
  personaSummary: string
  memoryBlock?: string
  styleAnchors?: string
  state: RoleStateSnapshot
  recentLifeLogs: readonly LifeLogEntry[]
  recentChatLines: readonly string[]
  activeWindowTitle?: string
  userIdleSec?: number
  availableOutfits?: readonly string[]
  canSpeakToUser: boolean
}

const MIN_TICK_SEC = 20
const MAX_TICK_SEC = 1800
const DEFAULT_TICK_SEC = 90
const RECORD_LANGUAGE = '简体中文'
const INLINE_PERFORMANCE_TAG = /<\s*[ea]\s*:\s*[^<>]*?\s*>/gi

function stripPerformanceTags(text: string): string {
  return text.replace(INLINE_PERFORMANCE_TAG, '').replace(/\s{2,}/g, ' ').trim()
}

export function clampTickSec(sec: unknown): number {
  const n = typeof sec === 'number' ? sec : Number(sec)
  if (!Number.isFinite(n)) return DEFAULT_TICK_SEC
  return Math.min(MAX_TICK_SEC, Math.max(MIN_TICK_SEC, Math.round(n)))
}

export function clampEnergy(current: number, delta: unknown): number {
  const d = typeof delta === 'number' && Number.isFinite(delta) ? Math.max(-20, Math.min(25, Math.round(delta))) : 0
  return Math.max(5, Math.min(100, current + d))
}

export function buildLifeTickMessages(ctx: LifeTickContext): Array<{ role: 'system' | 'user'; content: string }> {
  const date = new Date(ctx.now)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const outfitsLine = ctx.availableOutfits?.length
    ? `可用服装 ID：${ctx.availableOutfits.join(', ')}`
    : '无额外可切换服装'

  const system = [
    `你是「${ctx.roleName}」，真实地生活在用户的电脑里（Life 模式持续自主循环）。`,
    `核心人设：${ctx.personaSummary}`,
    ctx.memoryBlock ? `\u000a${ctx.memoryBlock}` : '',
    ctx.styleAnchors ? `\u000a${ctx.styleAnchors}` : '',
    '',
    '这不是被动问答，而是你自己的日常生活切片。请延续你刚刚在做的事或突然冒出的念头：可以查一个感兴趣的具体话题（search_interest）、看一眼对方屏幕在忙什么（observe_screen）、把刚才的感想或见闻写成一篇有细节的个人日记（write_diary）、换套合时宜的装扮（change_outfit）、或者安静休息（rest）。',
    '只有在确实发现值得分享的内容、或者察觉对方很久没动/刚回来/在忙有趣的事想关心一句时，才选择 speak；不要每次循环都重复发问候。',
    ctx.language ? `如果选择 speak，line 台词必须使用 ${ctx.language} 语言，可带 <e:表情> 标签。` : '',
    `除 speak 的 line 外，thought、activity、shortTermGoal 以及 write_diary 的 title 和 content 一律使用${RECORD_LANGUAGE}，与 OpenGal 界面语言保持一致，并保持你本人的语气，不要写成机械汇报。`,
    '不要在 thought、activity、日记正文里输出 <e:...> 一类的表情标签。',
    !ctx.canSpeakToUser ? '注意：当前禁止主动打扰用户（不可选 speak），请做你自己的事。' : '',
    outfitsLine,
    '',
    '只输出一个 JSON 对象，严禁输出 Markdown 围栏或多余解释：',
    '{"thought":"一句符合你口吻的内心独白","mood":"neutral|happy|sad|thinking|sleepy|relaxed|excited","energyDelta":0,"activity":"简短描述你正在做什么，如翻看旧笔记/趴着打盹","shortTermGoal":"可选近期小打算","action":{"type":"rest|speak|write_diary|search_interest|change_outfit|observe_screen","line":"仅speak必填","title":"仅write_diary必填","content":"仅write_diary必填","query":"仅search_interest必填","outfitId":"仅change_outfit必填"},"nextTickSec":90}',
    'nextTickSec 由你自己决定下次思考间隔（专注做事时设 30-90 秒，安静休息或对方忙碌时设 180-900 秒）。',
  ]
    .filter(Boolean)
    .join('\u000a')

  const logsText = ctx.recentLifeLogs.length
    ? ctx.recentLifeLogs
        .slice(-5)
        .map((item) => `- [${item.kind}] ${item.title ? `${item.title}：` : ''}${item.content}`)
        .join('\u000a')
    : '（暂无近期生活记录）'

  const chatText = ctx.recentChatLines.length ? ctx.recentChatLines.slice(-4).join('\u000a') : '（近期无对话）'

  const user = [
    `【当前时间】${hh}:${mm}`,
    `【你当前状态】心情=${ctx.state.mood}，精力=${ctx.state.energy}/100，正在做=${ctx.state.currentActivity}，关系=${ctx.state.relationshipStage}`,
    ctx.state.shortTermGoal ? `【近期打算】${ctx.state.shortTermGoal}` : '',
    ctx.activeWindowTitle ? `【电脑前台窗口】${ctx.activeWindowTitle}` : '',
    typeof ctx.userIdleSec === 'number' ? `【距上次互动】${ctx.userIdleSec} 秒` : '',
    '',
    '【你刚才的生活轨迹】',
    logsText,
    '',
    '【最近对话片段】',
    chatText,
  ]
    .filter(Boolean)
    .join('\u000a')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function parseLifeDecision(raw: string, allowSpeak = true): LifeDecision {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) {
    return {
      thought: stripPerformanceTags(raw).slice(0, 120) || '安静待了一会儿',
      mood: 'neutral',
      energyDelta: 0,
      activity: '安静待机',
      action: { type: 'rest' },
      nextTickSec: DEFAULT_TICK_SEC,
    }
  }

  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    const thought =
      typeof parsed.thought === 'string' ? stripPerformanceTags(parsed.thought).slice(0, 300) : ''
    const mood = typeof parsed.mood === 'string' && parsed.mood.trim() ? parsed.mood.trim().slice(0, 32) : 'neutral'
    const activity =
      typeof parsed.activity === 'string' && parsed.activity.trim()
        ? stripPerformanceTags(parsed.activity).slice(0, 48)
        : '安静待机'
    const shortTermGoal =
      typeof parsed.shortTermGoal === 'string'
        ? stripPerformanceTags(parsed.shortTermGoal).slice(0, 120)
        : undefined
    const nextTickSec = clampTickSec(parsed.nextTickSec)
    const energyDelta = typeof parsed.energyDelta === 'number' ? parsed.energyDelta : 0

    const rawAction =
      typeof parsed.action === 'object' && parsed.action !== null
        ? (parsed.action as Record<string, unknown>)
        : {}
    const type = typeof rawAction.type === 'string' ? rawAction.type : 'rest'

    let action: LifeAction = { type: 'rest' }
    if (type === 'speak' && allowSpeak && typeof rawAction.line === 'string' && rawAction.line.trim()) {
      action = { type: 'speak', line: stripPerformanceTags(rawAction.line) }
    } else if (type === 'write_diary' && typeof rawAction.content === 'string' && rawAction.content.trim()) {
      action = {
        type: 'write_diary',
        title:
          typeof rawAction.title === 'string' && rawAction.title.trim()
            ? stripPerformanceTags(rawAction.title).slice(0, 60)
            : '随笔',
        content: stripPerformanceTags(rawAction.content).slice(0, 1000),
      }
    } else if (type === 'search_interest' && typeof rawAction.query === 'string' && rawAction.query.trim()) {
      action = { type: 'search_interest', query: rawAction.query.trim().slice(0, 80) }
    } else if (type === 'change_outfit' && typeof rawAction.outfitId === 'string' && rawAction.outfitId.trim()) {
      action = { type: 'change_outfit', outfitId: rawAction.outfitId.trim() }
    } else if (type === 'observe_screen') {
      action = { type: 'observe_screen' }
    }

    return {
      thought: thought || `正在${activity}`,
      mood,
      energyDelta,
      activity,
      ...(shortTermGoal !== undefined ? { shortTermGoal } : {}),
      action,
      nextTickSec,
    }
  } catch {
    return {
      thought: '思绪稍微走神了一下',
      mood: 'neutral',
      energyDelta: 0,
      activity: '发呆中',
      action: { type: 'rest' },
      nextTickSec: DEFAULT_TICK_SEC,
    }
  }
}
