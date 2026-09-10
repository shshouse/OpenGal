import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// 环境变量 ELECTRON_FORCE_IS_PACKAGED 会颠倒 app.isPackaged，
// 用 exe 是否位于 node_modules 判定真实运行形态
export function isDevRuntime(): boolean {
  return app.getPath('exe').replace(/\\/g, '/').includes('node_modules')
}

export function getModRoot(): string {
  if (process.env.OPENGAL_MOD_ROOT && fs.existsSync(process.env.OPENGAL_MOD_ROOT)) {
    return process.env.OPENGAL_MOD_ROOT
  }
  const exeDir = path.dirname(app.getPath('exe'))
  const candidates = isDevRuntime()
    ? [
        // dev 下 exe 在 node_modules/electron/dist，项目根为其余三层
        path.join(path.resolve(exeDir, '../../../'), 'mods')
      ]
    : [
        path.join(process.resourcesPath, 'mods'),
        path.join(exeDir, 'mods')
      ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}
let cachedDataRoot: string | null = null

export function getDataRoot(): string {
  if (cachedDataRoot) return cachedDataRoot
  const candidates: string[] = []
  if (process.env.OPENGAL_DATA_DIR) candidates.push(process.env.OPENGAL_DATA_DIR)
  const exeDir = path.dirname(app.getPath('exe'))
  candidates.push(
    isDevRuntime()
      ? path.join(path.resolve(exeDir, '../../../'), 'data')
      : path.join(exeDir, 'data')
  )
  for (const candidate of candidates) {
    if (ensureWritableDir(candidate)) {
      cachedDataRoot = candidate
      return candidate
    }
  }
  const fallback = path.join(app.getPath('userData'), 'data')
  ensureWritableDir(fallback)
  cachedDataRoot = fallback
  return fallback
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

export function toModUrl(absPath: string): string {
  const root = getModRoot()
  const rel = path.relative(root, absPath).replace(/\\/g, '/')
  const encoded = rel
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${CUSTOM_SCHEME}://${MOD_HOST}/${encoded}`
}
export function modUrlToAbsPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${CUSTOM_SCHEME}:`) return null
  if (parsed.hostname !== MOD_HOST) return null
  const relative = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  const resolved = path.resolve(getModRoot(), relative)
  const root = path.resolve(getModRoot())
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return null
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

export function getGenieTTSRoot(): string {
  const exeDir = path.dirname(app.getPath('exe'))
  const candidates = isDevRuntime()
    ? [path.join(path.resolve(exeDir, '../../../'), 'resources', 'genie')]
    : [
        path.join(process.resourcesPath, 'genie'),
        path.join(exeDir, 'resources', 'genie'),
      ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

export function getGeniePythonExe(): string {
  return path.join(getGenieTTSRoot(), 'runtime', 'python.exe')
}

export { CUSTOM_SCHEME, MOD_HOST }
