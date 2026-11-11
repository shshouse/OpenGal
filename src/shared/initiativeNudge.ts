import type { EnvSnapshot } from './types'
import { timeOfDayLabel } from './timeOfDay'

/** 主动开口时塞给主管线的提示；写清理由来源，避免角色凭空找话 */
export function buildInitiativeNudge(
  idleMinutes: number,
  env: EnvSnapshot | null,
  mode: 'agent' | 'life',
  now = new Date(),
  languageLabel?: string | null,
): string {
  const foreground = env?.foreground
  const appLine = foreground
    ? `对方现在在用 ${foreground.app}${foreground.title ? `（${foreground.title}）` : ''}。`
    : ''
  const lifeLine = mode === 'life' ? '你可以只是看着，也可以什么都不做。' : ''
  // 中文提示语会把模型带到中文台词，角色语言要在这里重申一次
  const languageLine = languageLabel ? `台词必须使用${languageLabel}。` : ''
  return `（你已经注意到对方 ${idleMinutes} 分钟没有理你了。现在是${timeOfDayLabel(now)}。${appLine}${lifeLine}如果你想开口，就用一两句符合你性格的话主动说点什么，自然、简短，不要提到"很久没说话"这类元信息。${languageLine}）`
}
