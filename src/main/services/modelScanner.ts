import fs from 'node:fs'
import path from 'node:path'
import type { Live2DModelConfig, RoleCardEntry } from '@shared/types'
import { toModUrl } from './paths'
import { listRoleCards } from './roleCardLoader'

const DEFAULT_PARAM_MAPPING: Live2DModelConfig['paramMapping'] = {
  angleX: 'ParamAngleX',
  angleY: 'ParamAngleY',
  angleZ: 'ParamAngleZ',
  bodyAngleX: 'ParamBodyAngleX',
  eyeBallX: 'ParamEyeBallX',
  eyeBallY: 'ParamEyeBallY'
}

function buildConfig(absPath: string): Live2DModelConfig {
  return {
    modelPath: absPath,
    modelUrl: toModUrl(absPath),
    folderPath: path.dirname(absPath),
    modelJsonFile: path.basename(absPath),
    canvasYRatio: 0.6,
    scale: 1,
    xRatio: 0.5,
    paramMapping: DEFAULT_PARAM_MAPPING
  }
}

/**
 * 解析默认模型：不写死任何角色。
 * 优先级：OPENGAL_DEFAULT_MODEL 环境变量 > 第一张带 live2d 配置的角色卡 > null（渲染端显示空态）。
 */
export function resolveDefaultModel(): Live2DModelConfig | null {
  const envModel = process.env.OPENGAL_DEFAULT_MODEL
  if (envModel && fs.existsSync(envModel)) return buildConfig(envModel)
  for (const card of listRoleCards()) {
    const fromCard = resolveModelFromCard(card)
    if (fromCard) return fromCard
  }
  return null
}

export function scanModel(folderPath: string, modelJsonFile: string): Live2DModelConfig | null {
  const fullPath = path.join(folderPath, modelJsonFile)
  if (!fs.existsSync(fullPath)) return null
  return buildConfig(fullPath)
}

/**
 * 从角色卡的 performance.live2d.modelPath 解析 Live2D 模型配置。
 * modelPath 相对于角色卡目录 (card.rootPath)。
 */
export function resolveModelFromCard(card: RoleCardEntry): Live2DModelConfig | null {
  const live2d = card.performance?.live2d
  if (!live2d?.modelPath) return null
  const absPath = path.isAbsolute(live2d.modelPath)
    ? live2d.modelPath
    : path.join(card.rootPath, live2d.modelPath)
  if (!fs.existsSync(absPath)) return null
  const config = buildConfig(absPath)
  if (live2d.canvasYRatio !== undefined) config.canvasYRatio = live2d.canvasYRatio
  if (live2d.scale !== undefined) config.scale = live2d.scale
  if (live2d.xRatio !== undefined) config.xRatio = live2d.xRatio
  if (live2d.paramMapping) config.paramMapping = { ...DEFAULT_PARAM_MAPPING, ...live2d.paramMapping }
  return config
}
