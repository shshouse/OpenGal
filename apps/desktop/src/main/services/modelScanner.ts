import fs from 'node:fs'
import path from 'node:path'
import type { Live2DModelConfig, RoleCardEntry } from '@shared/types'
import { getModRoot, toModUrl } from './paths'

const DEFAULT_MODEL_REL = path.join('Role', 'neuro', 'model', 'runtime', 'hiyori_free_t08.model3.json')

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

export function resolveDefaultModel(): Live2DModelConfig | null {
  const overrides: string[] = []
  if (process.env.OPENGAL_DEFAULT_MODEL) overrides.push(process.env.OPENGAL_DEFAULT_MODEL)
  overrides.push(path.join(getModRoot(), DEFAULT_MODEL_REL))
  for (const candidate of overrides) {
    if (fs.existsSync(candidate)) return buildConfig(candidate)
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
