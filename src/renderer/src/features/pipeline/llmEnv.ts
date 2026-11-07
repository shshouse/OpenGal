import type { ChatMessage } from '@shared/types'
import { CHANGE_STRONG, type ScreenPulse } from '@shared/screen'

export function buildEnvBlock(env: {
  timeText: string
  idleSeconds: number
  justReturned: boolean
  awayMinutes: number
  game: { name: string; fullscreen: boolean } | null
  foreground: { app: string; title: string; fullscreen: boolean } | null
  screen?: ScreenPulse | null
}): string {
  const lines = [`现在时间：${env.timeText}`]
  if (env.justReturned) {
    lines.push(`用户刚刚离开了约 ${env.awayMinutes} 分钟，现在回来了`)
  }
  if (env.game) {
    lines.push(
      `用户正在玩游戏《${env.game.name}》${env.game.fullscreen ? '（全屏中）' : ''}——回复要更简短，不要频繁打扰`,
    )
  } else if (env.foreground?.fullscreen && env.foreground.app) {
    lines.push(`用户正在全屏使用 ${env.foreground.app}`)
  } else if (env.foreground?.app) {
    lines.push(`用户当前前台应用：${env.foreground.app}`)
  }
  if (env.idleSeconds > 300) {
    lines.push(`用户已约 ${Math.round(env.idleSeconds / 60)} 分钟没有操作电脑`)
  }
  const screenLine = describeScreen(env.screen)
  if (screenLine) lines.push(screenLine)
  return `【当前环境】\n${lines.join('\n')}`
}

/** 只描述屏幕变没变，不描述内容——要内容就得自己去看。 */
function describeScreen(screen?: ScreenPulse | null): string | null {
  if (!screen) return null
  const sinceSec = Math.max(0, Math.round((Date.now() - screen.changedAt) / 1000))
  const peakRecent = sinceSec <= 45 && screen.peakScore >= CHANGE_STRONG
  if (peakRecent) return `屏幕刚刚换了画面（约 ${sinceSec} 秒前），可以用 look_screen 看看现在是什么`
  if (sinceSec < 30) return `屏幕刚有动静（约 ${sinceSec} 秒前）`
  if (sinceSec < 120) return `屏幕约 ${sinceSec} 秒前有过变化`
  return `屏幕已约 ${Math.round(sinceSec / 60)} 分钟没有明显变化`
}

export async function fetchEnvBlock(): Promise<ChatMessage | null> {
  try {
    const res = await window.opengal.env.get()
    if (res.success && res.data) {
      return { role: 'system', content: buildEnvBlock(res.data) }
    }
  } catch {
    /* 环境信息可选，失败不阻塞对话 */
  }
  return null
}
