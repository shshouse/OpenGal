import type { Live2DModelConfig } from '@shared/types'

// 同一模型时叠加用户保存的变换（缩放/位置），换了模型则用角色卡默认
export function mergeSavedTransform(
  cardConfig: Live2DModelConfig,
  saved: Live2DModelConfig | null | undefined
): Live2DModelConfig {
  const sameModel = !!saved?.modelPath && saved.modelPath === cardConfig.modelPath
  const hasRoleTransform = cardConfig.scale !== 1 || cardConfig.xRatio !== 0.5 || cardConfig.canvasYRatio !== 0.6
  // 旧角色首次打开时保留原来的本机显示效果；新设置写入角色卡后不再被全局值覆盖。
  if (hasRoleTransform) return { ...cardConfig }
  return {
    ...cardConfig,
    ...(sameModel && saved?.scale !== undefined ? { scale: saved.scale } : {}),
    ...(sameModel && saved?.xRatio !== undefined ? { xRatio: saved.xRatio } : {}),
    ...(sameModel && saved?.canvasYRatio !== undefined
      ? { canvasYRatio: saved.canvasYRatio }
      : {})
  }
}
