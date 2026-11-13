/** 角色卡校验用手写而不是 zod：读入时要归一化旧字段并过滤敏感字段，这两步 zod 不做。
 *  其余跨进程入参统一走 schemas.ts 的 zod schema。 */
import type {
  OutfitMode,
  PerformanceMode,
  RoleCard,
  RoleOutfit,
  RoleSpineConfig,
  RoleSpriteConfig,
  WindowMode,
} from './index'
import { sanitizeCardLlm } from './cardLlm'

export const CARD_SCHEMA_VERSION = 1

const MAX_TEXT = 20_000
const MAX_NAME = 64
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const WINDOW_MODES: WindowMode[] = ['mate', 'theater']
// 旧角色卡写的是 pet，读入时归一化，避免存量卡被判为非法
const LEGACY_WINDOW_MODES: Record<string, WindowMode> = { pet: 'mate' }
const PERFORMANCE_MODES: PerformanceMode[] = ['live2d', 'sprite', 'auto']

const KNOWN_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'displayName',
  'color',
  'language',
  'windowMode',
  'performance',
  'voice',
  'asr',
  'llm',
  'persona',
])

export interface RoleCardIssue {
  path: string
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface RoleCardValidation {
  ok: boolean
  card?: RoleCard
  issues: RoleCardIssue[]
}

type Obj = Record<string, unknown>

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSafeCardRelativePath(value: string): boolean {
  if (!value || value.includes('\0')) return false
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return false
  if (/^[A-Za-z]:/.test(normalized)) return false
  return !normalized.split('/').some((part) => part === '..')
}

function text(
  value: unknown,
  path: string,
  issues: RoleCardIssue[],
  opts: { required?: boolean; max?: number; fallback?: string } = {},
): string {
  const max = opts.max ?? MAX_TEXT
  if (value === undefined || value === null) {
    if (opts.required) {
      issues.push({ path, code: 'missing', message: '必填项缺失', severity: 'error' })
    }
    return opts.fallback ?? ''
  }
  if (typeof value !== 'string') {
    issues.push({ path, code: 'type', message: '应为字符串', severity: 'error' })
    return opts.fallback ?? ''
  }
  if (value.length > max) {
    issues.push({ path, code: 'too-long', message: `长度超过 ${max}`, severity: 'error' })
    return value.slice(0, max)
  }
  return value
}

function enumValue<T extends string>(
  value: unknown,
  allowed: T[],
  path: string,
  issues: RoleCardIssue[],
  fallback: T,
): T {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'string' && (allowed as string[]).includes(value)) return value as T
  issues.push({
    path,
    code: 'enum',
    message: `取值必须是 ${allowed.join(' / ')}`,
    severity: 'error',
  })
  return fallback
}

function normalizeWindowMode(value: unknown): unknown {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_WINDOW_MODES, value)
    ? LEGACY_WINDOW_MODES[value]
    : value
}

function relativePath(
  value: unknown,
  path: string,
  issues: RoleCardIssue[],
  required: boolean,
): string | undefined {
  if (value === undefined || value === null) {
    if (required) issues.push({ path, code: 'missing', message: '必填项缺失', severity: 'error' })
    return undefined
  }
  if (typeof value !== 'string' || !value) {
    issues.push({ path, code: 'type', message: '应为非空相对路径', severity: 'error' })
    return undefined
  }
  if (!isSafeCardRelativePath(value)) {
    issues.push({
      path,
      code: 'unsafe-path',
      message: '必须是不逃出角色卡目录的相对路径',
      severity: 'error',
    })
    return undefined
  }
  return value
}

const OUTFIT_MODES: OutfitMode[] = ['sprite', 'spine']

function validateSpriteBlock(
  value: unknown,
  path: string,
  issues: RoleCardIssue[],
  required: boolean,
): RoleSpriteConfig | undefined {
  if (value === undefined) {
    if (required) issues.push({ path, code: 'missing', message: 'sprite 模式需要该配置', severity: 'error' })
    return undefined
  }
  if (!isObject(value)) {
    issues.push({ path, code: 'type', message: '应为对象', severity: 'error' })
    return undefined
  }
  const spriteDir = relativePath(value.spriteDir, `${path}.spriteDir`, issues, true)
  const defaultSprite = relativePath(value.defaultSprite, `${path}.defaultSprite`, issues, true)
  if (!spriteDir || !defaultSprite) return undefined
  return {
    spriteDir,
    defaultSprite,
    ...(typeof value.scale === 'number' ? { scale: value.scale } : {}),
  }
}

function validateSpineBlock(
  value: unknown,
  path: string,
  issues: RoleCardIssue[],
  required: boolean,
): RoleSpineConfig | undefined {
  if (value === undefined) {
    if (required) issues.push({ path, code: 'missing', message: 'spine 模式需要该配置', severity: 'error' })
    return undefined
  }
  if (!isObject(value)) {
    issues.push({ path, code: 'type', message: '应为对象', severity: 'error' })
    return undefined
  }
  const skelPath = relativePath(value.skelPath, `${path}.skelPath`, issues, true)
  const atlasPath = relativePath(value.atlasPath, `${path}.atlasPath`, issues, true)
  if (!skelPath || !atlasPath) return undefined
  return {
    skelPath,
    atlasPath,
    ...(typeof value.scale === 'number' ? { scale: value.scale } : {}),
    ...(typeof value.xRatio === 'number' ? { xRatio: value.xRatio } : {}),
    ...(typeof value.yRatio === 'number' ? { yRatio: value.yRatio } : {}),
  }
}

function validateOutfits(value: unknown, issues: RoleCardIssue[]): RoleOutfit[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    issues.push({ path: 'performance.outfits', code: 'type', message: '应为数组', severity: 'error' })
    return undefined
  }
  const outfits: RoleOutfit[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const at = `performance.outfits[${index}]`
    if (!isObject(item)) {
      issues.push({ path: at, code: 'type', message: '应为对象', severity: 'error' })
      return
    }
    const id = text(item.id, `${at}.id`, issues, { required: true, max: MAX_NAME })
    if (!id) return
    if (!ID_RE.test(id)) {
      issues.push({
        path: `${at}.id`,
        code: 'format',
        message: '只能用字母、数字、下划线或短横线，且以字母或数字开头',
        severity: 'error',
      })
      return
    }
    if (seen.has(id)) {
      issues.push({ path: `${at}.id`, code: 'duplicate', message: '服装 id 重复', severity: 'error' })
      return
    }
    seen.add(id)
    const name = text(item.name, `${at}.name`, issues, { max: MAX_NAME }) || id
    const mode = enumValue(item.mode, OUTFIT_MODES, `${at}.mode`, issues, 'sprite')
    if (mode === 'sprite') {
      const sprite = validateSpriteBlock(item.sprite, `${at}.sprite`, issues, true)
      if (sprite) outfits.push({ id, name, mode, sprite })
      return
    }
    const spine = validateSpineBlock(item.spine, `${at}.spine`, issues, true)
    if (spine) outfits.push({ id, name, mode, spine })
  })
  return outfits.length ? outfits : undefined
}

function validatePerformance(value: unknown, issues: RoleCardIssue[]): RoleCard['performance'] {
  if (!isObject(value)) {
    issues.push({ path: 'performance', code: 'missing', message: '必填项缺失', severity: 'error' })
    return { mode: 'auto' }
  }
  const mode = enumValue(value.mode, PERFORMANCE_MODES, 'performance.mode', issues, 'auto')

  let live2d: RoleCard['performance']['live2d']
  if (value.live2d !== undefined) {
    if (!isObject(value.live2d)) {
      issues.push({ path: 'performance.live2d', code: 'type', message: '应为对象', severity: 'error' })
    } else {
      const modelPath = relativePath(
        value.live2d.modelPath,
        'performance.live2d.modelPath',
        issues,
        mode === 'live2d',
      )
      live2d = {
        ...(modelPath ? { modelPath } : { modelPath: '' }),
        ...(typeof value.live2d.scale === 'number' ? { scale: value.live2d.scale } : {}),
        ...(typeof value.live2d.xRatio === 'number' ? { xRatio: value.live2d.xRatio } : {}),
        ...(typeof value.live2d.canvasYRatio === 'number'
          ? { canvasYRatio: value.live2d.canvasYRatio }
          : {}),
      }
    }
  } else if (mode === 'live2d') {
    issues.push({ path: 'performance.live2d', code: 'missing', message: 'live2d 模式需要该配置', severity: 'error' })
  }

  const sprite = validateSpriteBlock(value.sprite, 'performance.sprite', issues, mode === 'sprite')

  const preferred = Array.isArray(value.preferred)
    ? value.preferred.filter((item): item is 'live2d' | 'sprite' => item === 'live2d' || item === 'sprite')
    : undefined

  const outfits = validateOutfits(value.outfits, issues)
  let defaultOutfit: string | undefined
  if (outfits) {
    const firstId = outfits[0]?.id ?? ''
    const requested = text(value.defaultOutfit, 'performance.defaultOutfit', issues, { max: MAX_NAME })
    defaultOutfit = requested || firstId
    if (!outfits.some((outfit) => outfit.id === defaultOutfit)) {
      issues.push({
        path: 'performance.defaultOutfit',
        code: 'not-found',
        message: '未指向已有服装，已回退到第一套',
        severity: 'warning',
      })
      defaultOutfit = firstId
    }
  }

  return {
    mode,
    ...(preferred?.length ? { preferred } : {}),
    ...(live2d ? { live2d } : {}),
    ...(sprite ? { sprite } : {}),
    ...(outfits ? { outfits, defaultOutfit } : {}),
  }
}

function validatePersona(value: unknown, issues: RoleCardIssue[]): RoleCard['persona'] {
  if (!isObject(value)) {
    issues.push({ path: 'persona', code: 'missing', message: '必填项缺失', severity: 'error' })
    return { description: '', personality: '' }
  }
  return {
    description: text(value.description, 'persona.description', issues, { required: true }),
    personality: text(value.personality, 'persona.personality', issues, { required: true }),
    ...(value.scenario !== undefined
      ? { scenario: text(value.scenario, 'persona.scenario', issues, { max: MAX_TEXT }) }
      : {}),
    ...(value.rules !== undefined
      ? { rules: text(value.rules, 'persona.rules', issues, { max: MAX_TEXT }) }
      : {}),
    ...(value.userIdentity !== undefined
      ? { userIdentity: text(value.userIdentity, 'persona.userIdentity', issues, { max: 2000 }) }
      : {}),
    ...(value.userTerm !== undefined
      ? { userTerm: text(value.userTerm, 'persona.userTerm', issues, { max: 200 }) }
      : {}),
  }
}

/** 有 error 即不可用；未知字段只记 warning。 */
export function validateRoleCard(raw: unknown, folderName = ''): RoleCardValidation {
  const issues: RoleCardIssue[] = []
  if (!isObject(raw)) {
    return { ok: false, issues: [{ path: '', code: 'type', message: '角色卡必须是 JSON 对象', severity: 'error' }] }
  }

  if (raw.schemaVersion !== undefined) {
    const version = raw.schemaVersion
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      issues.push({ path: 'schemaVersion', code: 'type', message: '应为正整数', severity: 'error' })
    } else if (version > CARD_SCHEMA_VERSION) {
      issues.push({
        path: 'schemaVersion',
        code: 'version',
        message: `该卡需要更新的 OpenGal（卡版本 ${version}，当前支持 ${CARD_SCHEMA_VERSION}）`,
        severity: 'error',
      })
    }
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      issues.push({ path: key, code: 'unknown-key', message: '未知字段，已忽略', severity: 'warning' })
    }
  }

  const name = text(raw.name, 'name', issues, { required: true, max: MAX_NAME })
  if (!name.trim()) {
    issues.push({ path: 'name', code: 'empty', message: '不能为空', severity: 'error' })
  }

  let id = folderName
  if (raw.id !== undefined) {
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) {
      // 非法 id 回退到目录名，避免拒绝旧卡
      issues.push({
        path: 'id',
        code: 'format',
        message: '只能包含字母、数字、下划线和短横线，且以字母或数字开头（最长 64）；已改用目录名',
        severity: 'warning',
      })
    } else {
      id = raw.id
    }
  }

  const color = raw.color
  if (color !== undefined && (typeof color !== 'string' || !COLOR_RE.test(color))) {
    issues.push({ path: 'color', code: 'format', message: '应为 #RGB / #RRGGBB 形式的颜色，已忽略', severity: 'warning' })
  }

  if (raw.llm !== undefined) {
    if (!isObject(raw.llm)) {
      issues.push({ path: 'llm', code: 'type', message: '应为对象', severity: 'error' })
    } else {
      const dropped = Object.keys(raw.llm).filter(
        (key) => !['provider', 'modelName', 'temperature', 'maxTokens', 'contextWindow', 'multimodal', 'thinking', 'thinkingBudget'].includes(key),
      )
      for (const key of dropped) {
        issues.push({
          path: `llm.${key}`,
          code: 'forbidden-key',
          message: '角色卡不允许覆盖该项（endpoint 与密钥只能来自全局配置），已丢弃',
          severity: 'warning',
        })
      }
    }
  }

  let voice: RoleCard['voice']
  if (raw.voice !== undefined) {
    if (!isObject(raw.voice)) {
      issues.push({ path: 'voice', code: 'type', message: '应为对象', severity: 'error' })
    } else {
      voice = {
        ...(typeof raw.voice.engine === 'string' ? { engine: raw.voice.engine.slice(0, 64) } : {}),
        ...(raw.voice.configRef !== undefined
          ? { configRef: relativePath(raw.voice.configRef, 'voice.configRef', issues, false) ?? '' }
          : {}),
      }
    }
  }

  let asr: RoleCard['asr']
  if (raw.asr !== undefined) {
    if (!isObject(raw.asr)) {
      issues.push({ path: 'asr', code: 'type', message: '应为对象', severity: 'error' })
    } else {
      asr = {
        ...(typeof raw.asr.enabled === 'boolean' ? { enabled: raw.asr.enabled } : {}),
        ...(raw.asr.language === 'zh' || raw.asr.language === 'ja' || raw.asr.language === 'en'
          ? { language: raw.asr.language }
          : {}),
      }
    }
  }

  const card: RoleCard = {
    id,
    name: name.trim(),
    windowMode: enumValue(
      normalizeWindowMode(raw.windowMode),
      WINDOW_MODES,
      'windowMode',
      issues,
      'mate',
    ),
    performance: validatePerformance(raw.performance, issues),
    persona: validatePersona(raw.persona, issues),
    ...(raw.displayName !== undefined
      ? { displayName: text(raw.displayName, 'displayName', issues, { max: MAX_NAME }) }
      : {}),
    ...(typeof color === 'string' && COLOR_RE.test(color) ? { color } : {}),
    ...(raw.language !== undefined
      ? { language: text(raw.language, 'language', issues, { max: MAX_NAME }) }
      : {}),
    ...(voice ? { voice } : {}),
    ...(asr ? { asr } : {}),
    ...(isObject(raw.llm) ? { llm: sanitizeCardLlm(raw.llm) } : {}),
  }

  const ok = issues.every((issue) => issue.severity !== 'error')
  return ok ? { ok, card, issues } : { ok, issues }
}
