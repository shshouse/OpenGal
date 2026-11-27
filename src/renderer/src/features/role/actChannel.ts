import {
  applyEmotion,
  getAvailableExpressions,
  getAvailableMotionGroups,
  pickExpression,
  playMotionGroup,
} from '@/features/live2d/live2dBus'
import { isSpeaking } from '@/features/speech/uiHandlers'

/**
 * 模型通过 act 工具请求皮套动作，实际能不能做由这里判断。
 * 返回明确原因，模型可以换成可用项重试，而不是静默失败。
 */
export function installRoleActChannel(): () => void {
  return window.opengal.role.onActRequest((requestId, request) => {
    const applied: string[] = []
    const errors: string[] = []

    if (request.expression) {
      const available = getAvailableExpressions()
      const picked = available.length ? pickExpression(request.expression, available) : null
      if (!picked) {
        errors.push(
          available.length
            ? `没有表情「${request.expression}」，可用：${available.join('、')}`
            : '当前皮套没有可切换的表情',
        )
      } else {
        applyEmotion(request.expression)
        applied.push(`表情 ${picked}`)
      }
    }

    if (request.motion) {
      const groups = getAvailableMotionGroups()
      const hit = groups.find((group) => group.toLowerCase() === request.motion?.toLowerCase())
      if (!hit) {
        errors.push(
          groups.length
            ? `没有动作「${request.motion}」，可用：${groups.join('、')}`
            : '当前皮套没有可用动作',
        )
      } else if (isSpeaking()) {
        errors.push('正在说话，动作会被打断，已跳过')
      } else {
        playMotionGroup(hit)
        applied.push(`动作 ${hit}`)
      }
    }

    if (errors.length > 0) {
      window.opengal.role.replyAct(requestId, { ok: false, applied, error: errors.join('；') })
      return
    }
    window.opengal.role.replyAct(requestId, { ok: true, applied })
  })
}
