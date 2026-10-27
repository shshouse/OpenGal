import type { EnvSnapshot } from './types'

function timeBucket(now: Date): string {
  const hour = now.getHours()
  if (hour < 6) return '深夜'
  if (hour < 9) return '清晨'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  if (hour < 23) return '晚上'
  return '深夜'
}

/** 主动开口时塞给主管线的提示；写清理由来源，避免角色凭空找话 */
export function buildInitiativeNudge(
  idleMinutes: number,
  env: EnvSnapshot | null,
  mode: 'agent' | 'life',
  now = new Date(),
): string {
  const foreground = env?.foreground
  const appLine = foreground
    ? `对方现在在用 ${foreground.app}${foreground.title ? `（${foreground.title}）` : ''}。`
    : ''
  const lifeLine = mode === 'life' ? '你可以只是看着，也可以什么都不做。' : ''
  return `（你已经注意到对方 ${idleMinutes} 分钟没有理你了。现在是${timeBucket(now)}。${appLine}${lifeLine}如果你想开口，就用一两句符合你性格的话主动说点什么，自然、简短，不要提到"很久没说话"这类元信息。）`
}
