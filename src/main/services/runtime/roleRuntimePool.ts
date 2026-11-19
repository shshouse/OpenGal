import { BrowserWindow } from 'electron'
import {
  buildLifeTickMessages,
  clampEnergy,
  parseLifeDecision,
  type LifeAction,
} from '@core/harness/lifeLoop'
import type { RoleMode, RoleStateSnapshot } from '@core/role/types'
import { IpcChannels } from '@shared/app/ipc-channels'
import { getErrorMessage } from '@shared/app/errors'
import type { ChatMessage, RoleCardEntry } from '@shared/types'
import { readConfig, writeConfig } from '../config/store'
import { logBus } from '../infra/logBus'
import { callLLM } from '../llm/client'
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
import { getOwnedRoleCard, listOwnedRoleCards } from '../role/cardLoader'
import { saveRoleCard } from '../role/cardWriter'
import { appendRoleLog } from '../role/roleLogs'
import { handleWebSearch } from '../tools/builtin'

export interface RuntimeRoleItem {
  roleId: string
  displayName: string
  mode: RoleMode
  running: boolean
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
  if (slot.disposed) return
  const clamped = Math.max(15_000, Math.min(30 * 60_000, delayMs))
  slot.timer = setTimeout(() => {
    slot.timer = null
    void executeLifeTick(slot.roleId)
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

  if (action.type === 'search_interest') {
    appendRoleLog(roleId, {
      level: 'info',
      scope: 'life',
      message: `自主检索兴趣话题：${action.query}`,
    })
    try {
      const searchRes = await handleWebSearch(action.query)
      const digest = searchRes.replace(/\s+/g, ' ').slice(0, 360)
      appendLifeLog(roleId, {
        kind: 'observation',
        title: `检索：${action.query}`,
        content: `${thought} | 摘要：${digest}`,
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
    const chatMsg: ChatMessage = { role: 'assistant', content: action.line, ts }
    saveChatMessages(roleId, [chatMsg as unknown as { role: string }])
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

export async function executeLifeTick(roleId: string): Promise<boolean> {
  const slot = slots.get(roleId)
  if (!slot || slot.disposed) return false

  const card = getOwnedRoleCard(roleId)
  if (!card || card.mode !== 'life') {
    clearSlotTimer(slot)
    return false
  }

  if (slot.thinking || Date.now() < slot.busyUntil) {
    scheduleNextLifeTick(slot, 30_000)
    return false
  }

  const llmCfg = readConfig().llm
  if (!llmCfg.apiKey || !llmCfg.baseURL || !llmCfg.modelName) {
    scheduleNextLifeTick(slot, 120_000)
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
      overrides: { temperature: 0.75, maxTokens: 450 },
    })

    if (slot.disposed || Date.now() < slot.busyUntil) {
      return false
    }

    const decision = parseLifeDecision(res.content)
    const nextTickAt = Date.now() + decision.nextTickSec * 1000
    patchRoleState(roleId, {
      mood: decision.mood,
      energy: clampEnergy(currentState.energy, decision.energyDelta),
      currentActivity: decision.activity,
      ...(decision.shortTermGoal !== undefined ? { shortTermGoal: decision.shortTermGoal } : {}),
      nextTickAt,
    })

    await performLifeAction(card, decision.action, decision.thought, decision.mood, decision.activity)
    scheduleNextLifeTick(slot, decision.nextTickSec * 1000)
    return true
  } catch (err) {
    logBus.warn('life', `角色 ${roleId} Life 心跳执行异常: ${getErrorMessage(err)}`)
    appendRoleLog(roleId, {
      level: 'warn',
      scope: 'life',
      message: 'Life 心跳异常，稍后重试',
      detail: getErrorMessage(err),
    })
    scheduleNextLifeTick(slot, 120_000)
    return false
  } finally {
    slot.thinking = false
    emitPoolChanged()
  }
}

export async function setRoleRunningInPool(
  roleId: string,
  running: boolean,
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
        content: `距离上次苏醒过去了约 ${Math.round(offlineMinutes / 60 * 10) / 10} 小时。`,
        mood: prevState.mood,
      })
    }
    patchRoleState(roleId, {
      currentActivity: card.mode === 'life' ? '观察桌面环境中' : '在旁待命',
      energy: offlineMinutes >= 60 ? clampEnergy(prevState.energy, 20) : prevState.energy,
    })
    appendRoleLog(roleId, {
      level: 'info',
      scope: 'runtime',
      message: `角色已唤醒（模式：${card.mode ?? 'agent'}）`,
    })

    const slot: ActiveRoleSlot = {
      roleId,
      timer: null,
      thinking: false,
      busyUntil: 0,
      disposed: false,
    }
    slots.set(roleId, slot)
    if (card.mode === 'life') {
      scheduleNextLifeTick(slot, 25_000)
    }
  }

  if (!focusedRoleId) focusedRoleId = roleId
  persistRuntimeFlags()
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
    patchRoleState(roleId, {
      currentActivity: mode === 'life' ? '开始自主生活' : '在旁待命',
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
  if (card?.mode === 'life') {
    scheduleNextLifeTick(slot, Math.max(holdMs + 15_000, 60_000))
  }
}

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
  let wokeAny = false
  for (const card of owned) {
    if (savedRunning[card.id]) {
      await setRoleRunningInPool(card.id, true)
      wokeAny = true
    }
  }
  if (!wokeAny && focusedRoleId) {
    await setRoleRunningInPool(focusedRoleId, true)
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
