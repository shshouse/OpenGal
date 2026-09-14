import type { Live2DModelConfig } from '@shared/types'

// 同一模型时叠加用户保存的变换（缩放/位置），换了模型则用角色卡默认
export function mergeSavedTransform(
  cardConfig: Live2DModelConfig,
  saved: Live2DModelConfig | null | undefined
): Live2DModelConfig {
  const sameModel = !!saved?.modelPath && saved.modelPath === cardConfig.modelPath
  return {
    ...cardConfig,
    ...(sameModel && saved?.scale !== undefined ? { scale: saved.scale } : {}),
    ...(sameModel && saved?.xRatio !== undefined ? { xRatio: saved.xRatio } : {}),
    ...(sameModel && saved?.canvasYRatio !== undefined
      ? { canvasYRatio: saved.canvasYRatio }
      : {})
  }
}
