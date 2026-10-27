import type { ChatMessage } from '@shared/types'

export function buildEnvBlock(env: {
  timeText: string
  idleSeconds: number
  justReturned: boolean
  awayMinutes: number
  game: { name: string; fullscreen: boolean } | null
  foreground: { app: string; title: string; fullscreen: boolean } | null
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
  return `【当前环境】\n${lines.join('\n')}`
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
