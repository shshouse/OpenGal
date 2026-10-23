import type { PerformanceMode, RoleCard, WindowMode } from './types'
import { sanitizeCardLlm } from './cardLlm'

/** 角色卡格式版本；加载器只接受小于等于该值的卡 */
export const CARD_SCHEMA_VERSION = 1

const MAX_TEXT = 20_000
const MAX_NAME = 64
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const WINDOW_MODES: WindowMode[] = ['pet', 'theater']
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

/** 角色卡内的路径必须是相对路径，且不能逃出卡片目录 */
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

  let sprite: RoleCard['performance']['sprite']
  if (value.sprite !== undefined) {
    if (!isObject(value.sprite)) {
      issues.push({ path: 'performance.sprite', code: 'type', message: '应为对象', severity: 'error' })
    } else {
      const spriteDir = relativePath(
        value.sprite.spriteDir,
        'performance.sprite.spriteDir',
        issues,
        mode === 'sprite',
      )
      const defaultSprite = relativePath(
        value.sprite.defaultSprite,
        'performance.sprite.defaultSprite',
        issues,
        mode === 'sprite',
      )
      sprite = {
        spriteDir: spriteDir ?? '',
        defaultSprite: defaultSprite ?? '',
        ...(typeof value.sprite.scale === 'number' ? { scale: value.sprite.scale } : {}),
      }
    }
  } else if (mode === 'sprite') {
    issues.push({ path: 'performance.sprite', code: 'missing', message: 'sprite 模式需要该配置', severity: 'error' })
  }

  const preferred = Array.isArray(value.preferred)
    ? value.preferred.filter((item): item is 'live2d' | 'sprite' => item === 'live2d' || item === 'sprite')
    : undefined

  return {
    mode,
    ...(preferred?.length ? { preferred } : {}),
    ...(live2d ? { live2d } : {}),
    ...(sprite ? { sprite } : {}),
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

/**
 * 校验并归一化角色卡。errors 非空即视为不可用，不做"尽力加载"。
 * 未知顶层字段只记 warning，便于格式向前扩展。
 */
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
      // 兼容旧卡：id 只作内部标识，非法时回退到目录名而不拒绝整张卡
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
    windowMode: enumValue(raw.windowMode, WINDOW_MODES, 'windowMode', issues, 'pet'),
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
