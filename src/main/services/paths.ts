import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getRolesRoot } from './roleStore'

// 测试与脚本环境没有 Electron app，取不到路径时按非打包形态降级
function getExePath(): string | null {
  try {
    return app.getPath('exe')
  } catch {
    return null
  }
}

// 环境变量 ELECTRON_FORCE_IS_PACKAGED 会颠倒 app.isPackaged，
// 用 exe 是否位于 node_modules 判定真实运行形态
export function isDevRuntime(): boolean {
  const exe = getExePath()
  return exe ? exe.replace(/\\/g, '/').includes('node_modules') : false
}

export function getModRoot(): string {
  if (process.env.OPENGAL_MOD_ROOT && fs.existsSync(process.env.OPENGAL_MOD_ROOT)) {
    return process.env.OPENGAL_MOD_ROOT
  }
  const exe = getExePath()
  if (!exe) return path.join(process.cwd(), 'mods')
  const exeDir = path.dirname(exe)
  const candidates = isDevRuntime()
    ? [
        // dev 下 exe 在 node_modules/electron/dist，项目根为其余三层
        path.join(path.resolve(exeDir, '../../../'), 'mods')
      ]
    : [
        // 用户模组优先放 exe 同级：可写、更新时不随程序文件被替换
        path.join(exeDir, 'mods'),
        path.join(process.resourcesPath, 'mods')
      ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  // 都不存在时返回首选路径，由调用方按「尚未创建」处理
  return candidates[0] ?? path.join(exeDir, 'mods')
}
let cachedDataRoot: string | null = null

export function getDataRoot(): string {
  if (cachedDataRoot) return cachedDataRoot
  const candidates: string[] = []
  if (process.env.OPENGAL_DATA_DIR) candidates.push(process.env.OPENGAL_DATA_DIR)
  const exe = getExePath()
  if (exe) {
    const exeDir = path.dirname(exe)
    candidates.push(
      isDevRuntime()
        ? path.join(path.resolve(exeDir, '../../../'), 'data')
        : path.join(exeDir, 'data')
    )
  }
  for (const candidate of candidates) {
    if (ensureWritableDir(candidate)) {
      cachedDataRoot = candidate
      return candidate
    }
  }
  let userData: string | null = null
  try {
    userData = app.getPath('userData')
  } catch {
    userData = null
  }
  const fallback = userData ? path.join(userData, 'data') : path.join(process.cwd(), 'data')
  ensureWritableDir(fallback)
  console.warn(`[paths] 安装目录不可写，数据回退到 ${fallback}`)
  cachedDataRoot = fallback
  return fallback
}

// 小型偏好（配置、UI 状态、localStorage）的根目录。
// 标准模式放用户 AppData；OPENGAL_PORTABLE=1 时留在安装目录。
let cachedPreferenceRoot: string | null = null

export function getPreferenceRoot(): string {
  if (cachedPreferenceRoot) return cachedPreferenceRoot
  if (process.env.OPENGAL_PREFERENCE_DIR) {
    const explicit = process.env.OPENGAL_PREFERENCE_DIR
    if (ensureWritableDir(explicit)) {
      cachedPreferenceRoot = explicit
      return explicit
    }
  }
  const exe = getExePath()
  if (process.env.OPENGAL_PORTABLE === '1' && exe) {
    const portable = path.join(path.dirname(exe), 'userdata')
    if (ensureWritableDir(portable)) {
      cachedPreferenceRoot = portable
      return portable
    }
  }
  let base: string
  try {
    base = app.getPath('appData')
  } catch {
    base = exe ? path.dirname(exe) : process.cwd()
  }
  const preferred = path.join(base, isDevRuntime() ? 'OpenGal-dev' : 'OpenGal')
  if (ensureWritableDir(preferred)) {
    cachedPreferenceRoot = preferred
    return preferred
  }
  const fallback = exe ? path.join(path.dirname(exe), 'userdata') : path.join(process.cwd(), '.userdata')
  ensureWritableDir(fallback)
  cachedPreferenceRoot = fallback
  return fallback
}

// 备份必须活在数据目录之外：data 目录被整体删除或安装目录被替换时仍可恢复。
export function getBackupRoot(): string {
  const fromEnv = process.env.OPENGAL_BACKUP_DIR
  if (fromEnv) {
    ensureWritableDir(fromEnv)
    return fromEnv
  }
  try {
    const inDocuments = path.join(app.getPath('documents'), 'OpenGal', 'backups')
    if (ensureWritableDir(inDocuments)) return inDocuments
  } catch {
    // documents 不可用时回退到数据目录旁
  }
  return path.join(getDataRoot(), 'backups')
}
function ensureWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.write-probe')
    fs.writeFileSync(probe, '1')
    fs.rmSync(probe)
    return true
  } catch {
    return false
  }
}

const CUSTOM_SCHEME = 'opengal'
const MOD_HOST = 'mods'
const ROLE_HOST = 'roles'

function toAssetUrl(root: string, absPath: string, host: string): string {
  const rel = path.relative(root, absPath).replace(/\\/g, '/')
  const encoded = rel
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${CUSTOM_SCHEME}://${host}/${encoded}`
}

export function toModUrl(absPath: string): string {
  return toAssetUrl(getModRoot(), absPath, MOD_HOST)
}

// 实体化角色在 data/roles 下，不在 mods 根内，需要单独的 host
export function toRoleUrl(absPath: string): string {
  return toAssetUrl(getRolesRoot(getDataRoot()), absPath, ROLE_HOST)
}
export function modUrlToAbsPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${CUSTOM_SCHEME}:`) return null
  const roots: Record<string, string> = {
    [MOD_HOST]: getModRoot(),
    [ROLE_HOST]: getRolesRoot(getDataRoot()),
  }
  const root = roots[parsed.hostname]
  if (!root) return null
  const relative = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  const resolved = path.resolve(root, relative)
  const base = path.resolve(root)
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep
  if (resolved !== base && !resolved.startsWith(baseWithSep)) return null
  return resolved
}
function getFirstRoleVoiceDir(): string | null {
  const roleRoot = path.join(getModRoot(), 'Role')
  try {
    const first = fs.readdirSync(roleRoot, { withFileTypes: true }).find((d) => d.isDirectory())
    return first ? path.join(roleRoot, first.name, 'voice', 'gpt-sovits') : null
  } catch {
    return null
  }
}

export function getVoiceRoot(): string {
  return getFirstRoleVoiceDir() ?? path.join(getModRoot(), 'Role')
}

export function resolveVoicePath(relOrAbs: string): string {
  if (!relOrAbs) return ''
  if (path.isAbsolute(relOrAbs)) return relOrAbs
  return path.join(getVoiceRoot(), relOrAbs)
}

export function getResourceRoot(): string {
  if (isDevRuntime()) {
    const exeDir = path.dirname(app.getPath('exe'))
    return path.join(path.resolve(exeDir, '../../../'), 'resources')
  }
  return process.resourcesPath
}

export function getGenieTTSRoot(): string {
  const exeDir = path.dirname(app.getPath('exe'))
  const candidates = [
    path.join(getResourceRoot(), 'tts', 'genie'),
    path.join(getModRoot(), 'TTS', 'genie'),
    path.join(exeDir, 'resources', 'tts', 'genie')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0] ?? path.join(getResourceRoot(), 'tts', 'genie')
}

export function getGeniePythonExe(): string {
  const root = getGenieTTSRoot()
  // 模组可用 runtime.json 声明解释器（{"python": "D:/PythonMain/python.exe"}）；
  // 打包版则直接放 runtime/python.exe
  const manifest = path.join(root, 'runtime.json')
  try {
    if (fs.existsSync(manifest)) {
      const raw = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { python?: string }
      if (raw.python && fs.existsSync(raw.python)) return raw.python
    }
  } catch {
    // 配置损坏时退回默认路径，由启动流程报错
  }
  return path.join(root, 'runtime', 'python.exe')
}

export { CUSTOM_SCHEME, MOD_HOST, ROLE_HOST }
