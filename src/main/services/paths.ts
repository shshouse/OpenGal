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
