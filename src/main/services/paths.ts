import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve the repo root where `mods/` lives.
 * Dev: app.getAppPath() is the project root.
 * Packaged: assets ship via extraResources -> process.resourcesPath.
 */
export function getModRoot(): string {
  if (process.env.OPENGAL_MOD_ROOT && fs.existsSync(process.env.OPENGAL_MOD_ROOT)) {
    return process.env.OPENGAL_MOD_ROOT
  }
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'mods'),
        path.join(path.dirname(app.getPath('exe')), 'mods')
      ]
    : [
        path.join(app.getAppPath(), 'mods'),
        path.join(app.getAppPath(), '..', 'mods')
      ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

/**
 * 便携数据根目录：配置 / 会话历史等用户数据统一落在这里——
 * 装在哪放哪，不写进 C 盘系统目录。
 *
 * 解析顺序：
 * 1. OPENGAL_DATA_DIR 环境变量（测试/多实例用）
 * 2. dev：仓库根 data/
 * 3. 安装目录旁 data/（实测可写才认，Program Files 只读时探针失败）
 * 4. userData 兜底（极少数只读安装位）
 */
let cachedDataRoot: string | null = null

export function getDataRoot(): string {
  if (cachedDataRoot) return cachedDataRoot
  const candidates: string[] = []
  if (process.env.OPENGAL_DATA_DIR) candidates.push(process.env.OPENGAL_DATA_DIR)
  candidates.push(
    app.isPackaged
      ? path.join(path.dirname(app.getPath('exe')), 'data')
      : path.join(app.getAppPath(), 'data')
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

/** 确认目录可写：递归建目录 + 探针文件写删。失败返回 false（如 Program Files 只读）。 */
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

/**
 * Resolve an absolute filesystem path from the custom URL.
 * Returns null if the URL doesn't belong to this scheme or escapes the root.
 */
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

/**
 * 全局 voice 根目录（兜底用）：取 mods/Role 下第一个角色目录的 voice/gpt-sovits。
 * 不写死具体角色；正常路径下语音文件按角色卡目录解析（见 roleCardLoader.resolveRoleVoiceFile），
 * 这里只在无角色卡上下文的场景（如设置页全局测试）兜底。
 */
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

export { CUSTOM_SCHEME, MOD_HOST }
