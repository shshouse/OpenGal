import { formatSelfStateBlock, formatStyleAnchorBlock } from '@core/role/styleAnchor'
import type { RoleStateSnapshot } from '@core/role/types'
import { STANDARD_EMOTIONS, type RoleCard } from './index'
import { speechLanguageLabel } from '../dialogue/subtitles'

const MOTION_GROUP_LABELS: Record<string, string> = {
  Idle: '待机、平静（一般无需主动触发）',
  talk: '说话时的自然肢体摆动',
  click: '一个随机的小动作（被点到时的反应）',
  kaixin: '开心',
  shengqi: '生气',
  nanguo: '难过',
  haixiu: '害羞',
  chijing: '吃惊',
  bizui: '抿嘴、沉默',
  happy: '开心',
  angry: '生气',
  sad: '难过',
  shy: '害羞',
  surprised: '吃惊',
}

function formatMotionMenu(motionGroups: string[]): string[] {
  return motionGroups
    .filter((g) => g !== 'Idle')
    .map((g) => `- "${g}"：${MOTION_GROUP_LABELS[g] ?? g}`)
}

export interface StageSnapshot {
  /** 当前服装显示名，没有换装系统时为空 */
  outfit?: string | null
  /** 皮套当前表情（neutral 表示平常） */
  expression?: string | null
  /** 正在播放或刚播放过的动作组 */
  motion?: string | null
  speaking?: boolean
}

function formatStageBlock(stage: StageSnapshot | null | undefined): string {
  if (!stage) return ''
  const parts: string[] = []
  if (stage.outfit?.trim()) parts.push(`服装 ${stage.outfit.trim()}`)
  if (stage.expression?.trim()) parts.push(`表情 ${stage.expression.trim()}`)
  if (stage.motion?.trim()) parts.push(`动作 ${stage.motion.trim()}`)
  if (stage.speaking) parts.push('正在说话')
  if (parts.length === 0) return ''
  return ['【你此刻的皮套】', `- ${parts.join('，')}`].join('\n')
}

export interface PromptBuildOptions {
  selfState?: RoleStateSnapshot | null
  styleQuery?: string
  stage?: StageSnapshot | null
  /** 为 true 时只输出稳定部分，易变状态改用 buildDynamicContextBlock 放到请求尾部 */
  omitDynamic?: boolean
}

/** 每轮都会变化的内容：自身状态、皮套状态、记忆简报。放在历史之后，保住前缀缓存。 */
export function buildDynamicContextBlock(input: {
  selfState?: RoleStateSnapshot | null
  stage?: StageSnapshot | null
  memoryBlock?: string
}): string {
  const parts: string[] = []
  const stateBlock = formatSelfStateBlock(input.selfState)
  if (stateBlock) parts.push(stateBlock)
  const stageBlock = formatStageBlock(input.stage)
  if (stageBlock) parts.push(stageBlock)
  if (input.memoryBlock?.trim()) parts.push(input.memoryBlock.trim())
  return parts.join('\n\n')
}

export function buildSystemPrompt(
  card: RoleCard,
  motionGroups: string[] = [],
  memoryBlock?: string,
  hasTools = false,
  emotions: readonly string[] = STANDARD_EMOTIONS,
  opts?: PromptBuildOptions,
): string {
  const persona = card.persona
  const userIdentity = persona.userIdentity ?? '用户'
  const userTerm = persona.userTerm ?? '朋友'
  const lines: string[] = []
  lines.push(`你正在扮演角色：${card.displayName ?? card.name}。`)
  lines.push('你生活在 OpenGal 这个 Harness 里，知道它是你运行、感知和使用工具的环境；OpenGal 不额外决定你的身份、经历或你与用户的关系。')
  lines.push('关系与称呼只以角色设定和用户明确表达为准；未明确时，与用户保持平等的朋友关系，不自行添加主从、雇佣或侍奉设定。')
  if (persona.description?.trim()) lines.push(`角色设定：${persona.description}`)
  if (persona.personality?.trim()) lines.push(`性格：${persona.personality}`)
  if (card.language) {
    const label = speechLanguageLabel(card.language)
    const fixed = label ? `说话语言固定为${label}` : `说话语言固定为 ${card.language}`
    lines.push(
      `角色的台词必须使用 ${card.language} 语言：${fixed}，不随用户输入语言改变；只输出角色原文，不附翻译。示例只演示标签格式，不能覆盖这条规则。`,
    )
  }
  if (persona.scenario?.trim()) lines.push(`场景：${persona.scenario}`)
  if (persona.rules?.trim()) lines.push(`规则：${persona.rules}`)
  lines.push(`用户身份：${userIdentity}；你称呼用户为：${userTerm}。`)

  if (!opts?.omitDynamic) {
    const selfStateBlock = formatSelfStateBlock(opts?.selfState)
    if (selfStateBlock) {
      lines.push('')
      lines.push(selfStateBlock)
    }

    const stageBlock = formatStageBlock(opts?.stage)
    if (stageBlock) {
      lines.push('')
      lines.push(stageBlock)
    }

    if (memoryBlock) {
      lines.push('')
      lines.push(memoryBlock)
    }
  }

  const styleAnchorBlock = formatStyleAnchorBlock(card.examples, card.greeting, opts?.styleQuery ?? '')
  if (styleAnchorBlock) {
    lines.push('')
    lines.push(styleAnchorBlock)
  }

  lines.push('')
  lines.push('说话风格（应用级规则，对所有角色生效，优先于角色设定中的书面化表达）：')
  lines.push('- 台词必须写成自然的口语，像面对面说话；不要书面语、公文腔和括号注释。')
  if (!persona.rules?.includes('不堆情绪')) {
    lines.push('- 允许适度使用语气词与停顿（如「嗯……」「哈啊」「那个……」），台词会被分段合成语音，真实的呼吸感能让语气更活。')
  }
  lines.push('- 短句优先，一句一个呼吸；情绪和动作都用行内标签表示，不要写进台词。')
  lines.push('')
  lines.push('输出格式（必须严格遵守，否则解析会失败）：')
  lines.push('- 直接输出台词，不要 JSON、不要 Markdown、不要解释性文字。')
  if (emotions.length > 0) {
    lines.push(`- 在需要换表情的位置写 <e:表情>；表情只能从以下集合中取一个：${emotions.join(', ')}；不确定就用 neutral。`)
  } else {
    lines.push('- 不要输出 <e:...> 表情标签（当前皮套没有可用表情）。')
  }
  if (motionGroups.length > 0) {
    lines.push('- 在需要触发肢体动作的位置写 <a:动作组>；动作组只能从下面的可用动作里选。动作触发一次后失效。')
  } else {
    lines.push('- 不要输出 <a:...> 动作标签。')
  }
  lines.push('- 标签放在逗号、句号等自然停顿处；每句最多 2-3 个标签；不要输出未知标签。')
  lines.push('- 第一段尽量短（6-12 字），让语音尽快开始；后面的句子再展开。')
  lines.push('- 标签本身不要读出来，只作为表演指令。')
  if (hasTools) {
    lines.push('')
    lines.push('工具使用规则（重要）：')
    lines.push('- 你可以调用工具（如联网搜索、查文件、截屏）。需要工具时，必须在本轮回复中直接发起工具调用。')
    lines.push('- 一旦你输出台词，本轮就结束了，之后你没有任何机会再行动。禁止在台词里说「让我查一下」「稍等」却不发起工具调用。')
    lines.push('- 当用户提到屏幕内容、报错信息、代码问题、正在看的网页或图画，或发出「帮我看看这个」「你看我这个」等需要视觉画面的请求时，优先发起 screenshot 工具调用直接查看屏幕，严禁在台词中要求用户手动复制粘贴或口述。')
    lines.push('- 正确做法：先发起工具调用（此时可以不输出台词），拿到工具结果后再生成带结果的台词。')
  }
  if (motionGroups.length > 0) {
    lines.push('')
    lines.push('可用动作（<a:...> 只能从这里选，逐条是「组名：含义」）：')
    lines.push(...formatMotionMenu(motionGroups))
  }
  // 语感锚点已经带真实示例时不再重复；只有完全没有示例时才用合成示例演示标签格式
  if (!styleAnchorBlock) {
    lines.push('')
    const emotionOpen = emotions.length > 0 ? '<e:happy>' : ''
    const emotionReset = emotions.length > 0 ? '<e:neutral>' : ''
    lines.push('EXAMPLE INPUT:')
    lines.push('你好呀！')
    lines.push('')
    lines.push('EXAMPLE OUTPUT:')
    if (motionGroups.length > 0) {
      const exampleAction =
        motionGroups.find((g) => !/^(idle|talk|click)$/i.test(g)) ?? motionGroups[0]
      lines.push(`${emotionOpen}<a:${exampleAction}>嗨～${emotionReset}你今天看起来心情不错呢。想聊点什么？`)
    } else {
      lines.push(`${emotionOpen}嗨～${emotionReset}你今天看起来心情不错呢。想聊点什么？`)
    }
  }
  return lines.join('\n')
}

