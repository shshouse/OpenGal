import { z } from 'zod'
import { requestRoleAct } from '../role/actBridge'
import { defineTool } from './defineTool'

const actSchema = z.object({
  expression: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('要切换到的表情名，从系统提示的表情集合里选；不填则不改表情'),
  motion: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('要播放的动作组名，必须是可用动作列表里的一个；不填则不播动作'),
})

export const actTool = defineTool(
  {
    name: 'act',
    description:
      '让皮套做一个动作或换一个表情。适合在开口前先做动作、或在沉默时做反应。台词中间的表情变化仍用行内 <e:...> 标签，不要用这个工具逐句改表情。参数只能用当前角色真实存在的动作组和表情。',
    schema: actSchema,
  },
  async ({ expression, motion }) => {
    if (!expression && !motion) return '没有指定表情或动作，什么也没做。'
    const result = await requestRoleAct({
      ...(expression ? { expression } : {}),
      ...(motion ? { motion } : {}),
    })
    if (!result.ok) {
      return `皮套没有执行：${result.error ?? '未知原因'}。请换成可用的动作或表情。`
    }
    return `已执行：${result.applied.join('、')}。`
  },
)
