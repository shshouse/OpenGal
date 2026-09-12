import { powerMonitor, screen } from 'electron'
import { readConfig } from './configStore'
import type { EnvSnapshot } from '@shared/types'

const POLL_MS = 30_000
const AWAY_THRESHOLD_SEC = 600
const JUST_RETURNED_MS = 120_000

let away = false
let awaySince = 0
let lastAwayMinutes = 0
let justReturnedUntil = 0
let started = false

interface ForegroundInfo {
  app: string
  title: string
  fullscreen: boolean
}

let lastForeground: ForegroundInfo | null = null
let nativeBroken = false

function sampleForeground(): void {
  if (nativeBroken) return
  try {
    const mod = require('get-windows') as {
      activeWindowSync: () => {
        title?: string
        bounds?: { x: number; y: number; width: number; height: number }
        owner?: { name?: string; path?: string }
      } | undefined
    }
    const w = mod.activeWindowSync()
    if (!w) {
      lastForeground = null
      return
    }
    let fullscreen = false
    if (w.bounds) {
      const wa = screen.getPrimaryDisplay().workArea
      fullscreen =
        w.bounds.x <= wa.x &&
        w.bounds.y <= wa.y &&
        w.bounds.width >= wa.width &&
        w.bounds.height >= wa.height
    }
    lastForeground = {
      app: w.owner?.name ?? '',
      title: w.title ?? '',
      fullscreen,
    }
  } catch (err) {
    nativeBroken = true
    console.warn(`[env] get-windows 不可用，前台检测停用: ${(err as Error).message}`)
  }
}

function markAway(): void {
  if (!away) {
    away = true
    awaySince = Date.now()
  }
}

function markReturn(): void {
  if (away) {
    lastAwayMinutes = Math.max(1, Math.round((Date.now() - awaySince) / 60_000))
    away = false
    justReturnedUntil = Date.now() + JUST_RETURNED_MS
  }
}

function poll(): void {
  try {
    const idle = powerMonitor.getSystemIdleTime()
    if (!away && idle >= AWAY_THRESHOLD_SEC) markAway()
    else if (away && idle < AWAY_THRESHOLD_SEC) markReturn()
  } catch {
    /* ignore */
  }
}

export function startEnvMonitor(): void {
  if (started) return
  started = true
  powerMonitor.on('lock-screen', markAway)
  powerMonitor.on('unlock-screen', markReturn)
  powerMonitor.on('resume', markReturn)
  sampleForeground()
  setInterval(() => {
    poll()
    sampleForeground()
  }, POLL_MS)
}

function formatTime(now: Date): string {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function getMatchedGame(): { name: string; fullscreen: boolean } | null {
  const cfg = readConfig().gameMode
  if (!cfg.enabled || !lastForeground) return null
  const hay = `${lastForeground.app} ${lastForeground.title}`.toLowerCase()
  for (const g of cfg.games) {
    if (g && hay.includes(g.toLowerCase())) {
      return { name: g, fullscreen: lastForeground.fullscreen }
    }
  }
  return null
}

export function getEnvSnapshot(): EnvSnapshot {
  const now = new Date()
  const game = getMatchedGame()
  return {
    timeText: formatTime(now),
    idleSeconds: (() => {
      try {
        return powerMonitor.getSystemIdleTime()
      } catch {
        return 0
      }
    })(),
    justReturned: Date.now() < justReturnedUntil,
    awayMinutes: lastAwayMinutes,
    game,
    foreground: lastForeground
      ? { app: lastForeground.app, title: lastForeground.title, fullscreen: lastForeground.fullscreen }
      : null,
  }
}
