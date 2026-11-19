import { BrowserWindow } from 'electron'
import {
  buildLifeTickMessages,
  clampEnergy,
  parseLifeDecision,
  type LifeAction,
} from '@core/harness/lifeLoop'
import { formatStyleAnchorBlock } from '@core/role/styleAnchor'
import type { RoleMode, RoleStateSnapshot } from '@core/role/types'
import { IpcChannels } from '@shared/app/ipc-channels'
import { getErrorMessage } from '@shared/app/errors'
import { summarizeToolResult } from '@shared/dialogue/toolSummary'
import type { ChatMessage, RoleCardEntry } from '@shared/types'
import { readConfig, writeConfig } from '../config/store'
import { logBus } from '../infra/logBus'
import { callLLM } from '../llm/client'
import { getMemoryBlock } from '../memory'
import {
  appendLifeLog,
  getRoleState,
  listLifeLogs,
  listUnarchivedMessages,
  memoryDbReady,
  patchRoleState,
  saveChatMessages,
  sleepRoleDb,
} from '../memory/db'
import { getEnvSnapshot } from '../perception/envContext'
import { isScreenWatchEnabled, lookAtScreen } from '../perception/screenWatch'
import { getOwnedRoleCard, listOwnedRoleCards } from '../role/cardLoader'
import { saveRoleCard } from '../role/cardWriter'
import { appendRoleLog } from '../role/roleLogs'
import { handleWebSearch } from '../tools/builtin'

export interface RuntimeRoleItem {
  roleId: string
  displayName: string
  mode: RoleMode
  running: boolean
  lifePaused: boolean
  thinking: boolean
  state: RoleStateSnapshot
}

export interface RuntimePoolSnapshot {
  focusedRoleId: string | null
  runningRoleIds: string[]
  roles: Record<string, RuntimeRoleItem>
}

export interface AutonomousSpeakPayload {
  roleId: string
  line: string
  mood: string
  activity: string
  ts: number
}

interface ActiveRoleSlot {
  roleId: string
  timer: ReturnType<typeof setTimeout> | null
  thinking: boolean
  lifePaused: boolean
  busyUntil: number
  disposed: boolean
}

const slots = new Map<string, ActiveRoleSlot>()
let focusedRoleId: string | null = null
let initialized = false

function broadcast(channel: string, payload: unknown): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  } catch {
    // 非 Electron 测试环境跳过窗口广播
  }
}

function clearSlotTimer(slot: ActiveRoleSlot): void {
  if (slot.timer) {
    clearTimeout(slot.timer)
    slot.timer = null
  }
}

function persistRuntimeFlags(): void {
  const runningRoles: Record<string, boolean> = {}
  for (const card of listOwnedRoleCards()) {
    runningRoles[card.id] = slots.has(card.id)
  }
  writeConfig({
    activeRoleId: focusedRoleId,
    runningRoles,
  })
}

export function getRuntimePoolSnapshot(): RuntimePoolSnapshot {
  const cards = listOwnedRoleCards()
  const roles: Record<string, RuntimeRoleItem> = {}

  if (focusedRoleId && !cards.some((c) => c.id === focusedRoleId)) {
    focusedRoleId = cards[0]?.id ?? null
  } else if (!focusedRoleId && cards.length > 0) {
    focusedRoleId = cards[0]!.id
  }

  for (const card of cards) {
    const slot = slots.get(card.id)
    const running = Boolean(slot)
    const state = running
      ? getRoleState(card.id)
      : {
          mood: card.summary?.mood ?? 'neutral',
          energy: card.summary?.energy ?? 85,
          relationshipStage: '初识朋友',
          currentActivity: card.summary?.currentActivity ?? '休息中',
          shortTermGoal: '',
          nextTickAt: null,
          updatedAt: card.summary?.lastActiveAt ?? Date.now(),
        }
    roles[card.id] = {
      roleId: card.id,
      displayName: card.displayName ?? card.name,
      mode: card.mode ?? 'agent',
      running,
      lifePaused: slot ? slot.lifePaused : card.mode === 'life',
      thinking: slot?.thinking ?? false,
      state,
    }
  }

  return {
    focusedRoleId,
    runningRoleIds: [...slots.keys()],
    roles,
  }
}

function emitPoolChanged(): RuntimePoolSnapshot {
  const snap = getRuntimePoolSnapshot()
  broadcast(IpcChannels.runtime.changed, snap)
  return snap
}

function scheduleNextLifeTick(slot: ActiveRoleSlot, delayMs: number): void {
  clearSlotTimer(slot)
  if (slot.disposed || slot.lifePaused) return
  const clamped = Math.max(20_000, Math.min(30 * 60_000, delayMs))
  slot.timer = setTimeout(() => {
    slot.timer = null
    void executeLifeTick(slot.roleId, false)
  }, clamped)
}

function formatRecentDialogSnippet(roleId: string): string[] {
  const rows = listUnarchivedMessages(roleId).slice(-4)
  const lines: string[] = []
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.content) as ChatMessage
      const text =
        typeof parsed.content === 'string'
          ? parsed.content
          : parsed.content.map((p) => (p.type === 'text' ? p.text ?? '' : '[图片]')).join(' ')
      const clean = text.replace(/\s+/g, ' ').trim().slice(0, 120)
      if (clean) lines.push(`${row.role === 'user' ? '对方' : '我'}: ${clean}`)
    } catch {
      continue
    }
  }
  return lines
}

async function performScreenObservation(
  card: RoleCardEntry,
  thought: string,
  mood: string,
): Promise<void> {
  const roleId = card.id
  if (isScreenWatchEnabled()) {
    try {
      const shot = await lookAtScreen(1200)
      if (shot?.png) {
        const res = await callLLM({
          slot: 'sub',
          overrides: { temperature: 0.6, maxTokens: 160 },
          messages: [
            {
              role: 'system',
              content: `你是「${card.displayName ?? card.name}」，请用一两句简洁的简体中文内心观察，描述你刚在用户屏幕上看到的内容与感想（不要输出表情标签）。`,
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: `你刚才在想：${thought}。这是你瞥见的用户桌面画面：` },
                { type: 'image_url', image_url: { url: shot.png } },
              ],
            },
          ],
        })
        const obs = res.content.replace(/<\s*[ea]\s*:\s*[^<>]*?\s*>/gi, '').trim().slice(0, 260)
        if (obs) {
          appendLifeLog(roleId, {
            kind: 'observation',
            title: '观察屏幕画面',
            content: obs,
            mood,
          })
          return
        }
      }
    } catch (err) {
      logBus.warn('life', `角色 ${roleId} 观察屏幕失败: ${getErrorMessage(err)}`)
    }
  }

  let fallback = thought
  try {
    const env = getEnvSnapshot()
    if (env.game) {
      fallback = `${thought}（注意到对方正在玩 ${env.game.name}）`
    } else if (env.foreground?.title) {
      fallback = `${thought}（当前前台窗口：${env.foreground.app} - ${env.foreground.title.slice(0, 80)}）`
    }
  } catch {
    /* ignore */
  }
  appendLifeLog(roleId, {
    kind: 'observation',
    title: '观察桌面窗口',
    content: fallback,
    mood,
  })
}

async function performLifeAction(
  card: RoleCardEntry,
  action: LifeAction,
  thought: string,
  mood: string,
  activity: string,
): Promise<void> {
  const roleId = card.id
  if (action.type === 'write_diary') {
    appendLifeLog(roleId, {
      kind: 'diary',
      title: action.title,
      content: action.content,
      mood,
    })
    appendRoleLog(roleId, {
      level: 'info',
      scope: 'life',
      message: `写下日记《${action.title}》`,
      detail: action.content,
    })
    return
  }

  if (action.type === 'observe_screen') {
    await performScreenObservation(card, thought, mood)
    return
  }

  if (action.type === 'search_interest') {
    appendRoleLog(roleId, {
      level: 'info',
      scope: 'life',
      message: `自主检索兴趣话题：${action.query}`,
    })
    try {
      const searchRes = await handleWebSearch(action.query)
      const digest = summarizeToolResult('web_search', searchRes).slice(0, 240)
      appendLifeLog(roleId, {
        kind: 'observation',
        title: `检索：${action.query}`,
        content: digest ? `${thought}；${digest}` : thought,
        mood,
      })
    } catch (err) {
      appendLifeLog(roleId, {
        kind: 'thought',
        title: '',
        content: `${thought}（想查「${action.query}」但网络未通）`,
        mood,
      })
      logBus.warn('life', `角色 ${roleId} 自主搜索失败: ${getErrorMessage(err)}`)
    }
    return
  }

  if (action.type === 'change_outfit') {
    const valid = card.performance.outfits?.some((o) => o.id === action.outfitId)
    if (valid) {
      saveRoleCard(roleId, {
        displayName: card.displayName,
        color: card.color,
        language: card.language,
        mode: card.mode,
        greeting: card.greeting,
        examples: card.examples,
        activeOutfitId: action.outfitId,
        persona: card.persona,
      })
      broadcast(IpcChannels.role.outfitChanged, { roleId, outfitId: action.outfitId })
      appendLifeLog(roleId, {
        kind: 'action',
        title: '自主换装',
        content: `换上了装扮 ${action.outfitId}（${thought}）`,
        mood,
      })
    }
    return
  }

  if (action.type === 'speak') {
    const ts = Date.now()
    const clientId = `life:${roleId}:${ts}`
    const chatMsg: ChatMessage = { role: 'assistant', content: action.line, ts, clientId }
    saveChatMessages(roleId, [chatMsg as unknown as { role: string; ts: number; clientId: string }])
    appendLifeLog(roleId, {
      kind: 'action',
      title: '主动搭话',
      content: action.line,
      mood,
    })
    appendRoleLog(roleId, {
      level: 'info',
      scope: 'life',
      message: `主动开口：${action.line.slice(0, 80)}`,
    })
    const payload: AutonomousSpeakPayload = {
      roleId,
      line: action.line,
      mood,
      activity,
      ts,
    }
    broadcast(IpcChannels.runtime.autonomousSpeak, payload)
    return
  }

  appendLifeLog(roleId, {
    kind: 'thought',
    title: '',
    content: thought,
    mood,
  })
}

export async function executeLifeTick(roleId: string, force = false): Promise<boolean> {
  const slot = slots.get(roleId)
  if (!slot || slot.disposed) return false

  const card = getOwnedRoleCard(roleId)
  if (!card || card.mode !== 'life') {
    clearSlotTimer(slot)
    return false
  }

  if (!force && slot.lifePaused) {
    clearSlotTimer(slot)
    return false
  }

  if (slot.thinking || (!force && Date.now() < slot.busyUntil)) {
    if (!slot.lifePaused) scheduleNextLifeTick(slot, 30_000)
    return false
  }

  const llmCfg = readConfig().llm
  if (!llmCfg.apiKey || !llmCfg.baseURL || !llmCfg.modelName) {
    if (!slot.lifePaused) scheduleNextLifeTick(slot, 120_000)
    return false
  }

  slot.thinking = true
  emitPoolChanged()

  try {
    await memoryDbReady()
    const currentState = getRoleState(roleId)
    const recentLogs = listLifeLogs(roleId, { limit: 6 })
    const recentMessages = formatRecentDialogSnippet(roleId)
    const outfits = (card.performance.outfits ?? []).map((o) => `${o.id}(${o.name})`)
    const memoryBlock =
      (await getMemoryBlock(roleId, currentState.currentActivity || card.name, false).catch(() => null)) ??
      undefined
    const styleAnchors =
      formatStyleAnchorBlock(card.examples, card.greeting, currentState.currentActivity) || undefined

    let activeWindowTitle: string | undefined
    let userIdleSec: number | undefined
    try {
      const env = getEnvSnapshot()
      activeWindowTitle = env.game
        ? `${env.game.name}${env.game.fullscreen ? '（全屏游戏）' : ''}`
        : env.foreground
          ? `${env.foreground.app} - ${env.foreground.title}`.slice(0, 100)
          : undefined
      userIdleSec = env.idleSeconds
    } catch {
      /* ignore env snapshot errors */
    }

    const promptMsgs = buildLifeTickMessages({
      now: Date.now(),
      roleName: card.displayName ?? card.name,
      language: card.language,
      personaSummary: `${card.persona.description}；性格：${card.persona.personality}`,
      memoryBlock,
      styleAnchors,
      state: currentState,
      recentLifeLogs: recentLogs,
      recentChatLines: recentMessages,
      activeWindowTitle,
      userIdleSec,
      availableOutfits: outfits,
      canSpeakToUser: !(userIdleSec !== undefined && userIdleSec > 1800),
    })

    const res = await callLLM({
      slot: 'sub',
      messages: promptMsgs.map((m) => ({ role: m.role, content: m.content })),
      overrides: { temperature: 0.78, maxTokens: 520 },
    })

    if (slot.disposed || (!force && Date.now() < slot.busyUntil)) {
      return false
    }

    const decision = parseLifeDecision(res.content)
    const nextTickAt = slot.lifePaused ? null : Date.now() + decision.nextTickSec * 1000
    patchRoleState(roleId, {
      mood: decision.mood,
      energy: clampEnergy(currentState.energy, decision.energyDelta),
      currentActivity: decision.activity,
      ...(decision.shortTermGoal !== undefined ? { shortTermGoal: decision.shortTermGoal } : {}),
      nextTickAt,
    })

    await performLifeAction(card, decision.action, decision.thought, decision.mood, decision.activity)
    if (!slot.lifePaused) {
      scheduleNextLifeTick(slot, decision.nextTickSec * 1000)
    }
    return true
  } catch (err) {
    logBus.warn('life', `角色 ${roleId} Life 心跳执行异常: ${getErrorMessage(err)}`)
    appendRoleLog(roleId, {
      level: 'warn',
      scope: 'life',
      message: 'Life 心跳异常，稍后重试',
      detail: getErrorMessage(err),
    })
    if (!slot.lifePaused) scheduleNextLifeTick(slot, 120_000)
    return false
  } finally {
    slot.thinking = false
    emitPoolChanged()
  }
}

export async function setRoleRunningInPool(
  roleId: string,
  running: boolean,
  opts: { startLifePaused?: boolean } = {},
): Promise<RuntimePoolSnapshot> {
  await memoryDbReady()
  const card = getOwnedRoleCard(roleId)
  if (!card) throw new Error(`未找到角色实例：${roleId}`)

  if (!running) {
    const existing = slots.get(roleId)
    if (existing) {
      existing.disposed = true
      clearSlotTimer(existing)
      slots.delete(roleId)
    }
    patchRoleState(roleId, { currentActivity: '休息中', nextTickAt: null })
    appendRoleLog(roleId, { level: 'info', scope: 'runtime', message: '角色转入休眠并合并记忆库' })
    sleepRoleDb(roleId)
    persistRuntimeFlags()
    return emitPoolChanged()
  }

  if (!slots.has(roleId)) {
    const prevState = getRoleState(roleId)
    const offlineMinutes = Math.round((Date.now() - prevState.updatedAt) / 60_000)
    if (offlineMinutes >= 30) {
      appendLifeLog(roleId, {
        kind: 'observation',
        title: '重新唤醒',
        content: `距离上次苏醒过去了约 ${Math.round((offlineMinutes / 60) * 10) / 10} 小时。`,
        mood: prevState.mood,
      })
    }
    const startPaused = Boolean(opts.startLifePaused && card.mode === 'life')
    patchRoleState(roleId, {
      currentActivity:
        card.mode === 'life' ? (startPaused ? '自主生活已暂停' : '观察桌面环境中') : '在旁待命',
      energy: offlineMinutes >= 60 ? clampEnergy(prevState.energy, 20) : prevState.energy,
      ...(startPaused ? { nextTickAt: null } : {}),
    })
    appendRoleLog(roleId, {
      level: 'info',
      scope: 'runtime',
      message: `角色已唤醒（模式：${card.mode ?? 'agent'}${startPaused ? '，自主循环待手动开始' : ''}）`,
    })

    const slot: ActiveRoleSlot = {
      roleId,
      timer: null,
      thinking: false,
      lifePaused: startPaused,
      busyUntil: 0,
      disposed: false,
    }
    slots.set(roleId, slot)
    if (card.mode === 'life' && !startPaused) {
      scheduleNextLifeTick(slot, 25_000)
    }
  }

  if (!focusedRoleId) focusedRoleId = roleId
  persistRuntimeFlags()
  return emitPoolChanged()
}

export async function setRoleLifePausedInPool(
  roleId: string,
  paused: boolean,
): Promise<RuntimePoolSnapshot> {
  await memoryDbReady()
  const card = getOwnedRoleCard(roleId)
  if (!card) throw new Error(`未找到角色实例：${roleId}`)

  let slot = slots.get(roleId)
  if (!slot && !paused) {
    await setRoleRunningInPool(roleId, true, { startLifePaused: false })
    slot = slots.get(roleId)
  }
  if (!slot) return emitPoolChanged()

  slot.lifePaused = paused
  if (paused) {
    clearSlotTimer(slot)
    patchRoleState(roleId, { currentActivity: '自主生活已暂停', nextTickAt: null })
    appendRoleLog(roleId, { level: 'info', scope: 'life', message: '已暂停自主生活循环' })
  } else {
    patchRoleState(roleId, { currentActivity: '开始自主生活' })
    appendRoleLog(roleId, { level: 'info', scope: 'life', message: '已开始自主生活循环' })
    if (card.mode === 'life') {
      scheduleNextLifeTick(slot, 15_000)
    }
  }
  return emitPoolChanged()
}

export async function setRoleModeInPool(
  roleId: string,
  mode: RoleMode,
): Promise<RuntimePoolSnapshot> {
  await memoryDbReady()
  const card = getOwnedRoleCard(roleId)
  if (!card) throw new Error(`未找到角色实例：${roleId}`)

  saveRoleCard(roleId, {
    displayName: card.displayName,
    color: card.color,
    language: card.language,
    mode,
    greeting: card.greeting,
    examples: card.examples,
    activeOutfitId: card.activeOutfitId,
    persona: card.persona,
  })

  const slot = slots.get(roleId)
  if (slot) {
    clearSlotTimer(slot)
    slot.lifePaused = false
    patchRoleState(roleId, {
      currentActivity: mode === 'life' ? '开始自主生活' : '在旁待命',
      ...(mode !== 'life' ? { nextTickAt: null } : {}),
    })
    if (mode === 'life') {
      scheduleNextLifeTick(slot, 20_000)
    }
  }
  appendRoleLog(roleId, { level: 'info', scope: 'runtime', message: `切换运行模式为 ${mode}` })
  return emitPoolChanged()
}

export function focusRoleInPool(roleId: string | null): RuntimePoolSnapshot {
  focusedRoleId = roleId
  persistRuntimeFlags()
  return emitPoolChanged()
}

export function notifyUserActivityOnRole(roleId: string, holdMs = 45_000): void {
  const slot = slots.get(roleId)
  if (!slot) return
  slot.busyUntil = Date.now() + holdMs
  const card = getOwnedRoleCard(roleId)
  if (card?.mode === 'life' && !slot.lifePaused) {
    scheduleNextLifeTick(slot, Math.max(holdMs + 15_000, 60_000))
  }
}

/** 启动时仅恢复上次显式处于运行中的角色，绝不自动唤醒休眠角色；且已运行的 Life 角色默认先暂停自主循环以免静默消耗费用 */
export async function initRoleRuntimePool(): Promise<RuntimePoolSnapshot> {
  if (initialized) return getRuntimePoolSnapshot()
  initialized = true
  await memoryDbReady()

  const cfg = readConfig()
  const owned = listOwnedRoleCards()
  focusedRoleId =
    (cfg.activeRoleId && owned.some((c) => c.id === cfg.activeRoleId) ? cfg.activeRoleId : null) ??
    owned[0]?.id ??
    null

  const savedRunning = cfg.runningRoles ?? {}
  for (const card of owned) {
    if (savedRunning[card.id]) {
      await setRoleRunningInPool(card.id, true, { startLifePaused: true })
    }
  }
  return getRuntimePoolSnapshot()
}

export function shutdownRoleRuntimePool(): void {
  for (const [roleId, slot] of slots.entries()) {
    slot.disposed = true
    clearSlotTimer(slot)
    slots.delete(roleId)
    try {
      sleepRoleDb(roleId)
    } catch {
      /* ignore */
    }
  }
  initialized = false
}
