import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve the repo root where `mod/` lives.
 * Dev: app.getAppPath() is the project root.
 * Packaged: assets ship via extraResources -> process.resourcesPath.
 */
export function getModRoot(): string {
  if (process.env.OPENGAL_MOD_ROOT && fs.existsSync(process.env.OPENGAL_MOD_ROOT)) {
    return process.env.OPENGAL_MOD_ROOT
  }
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'mod'),
        path.join(path.dirname(app.getPath('exe')), 'mod')
      ]
    : [
        path.join(app.getAppPath(), 'mod'),
        path.join(app.getAppPath(), '..', 'mod')
      ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

const CUSTOM_SCHEME = 'opengal'
const MOD_HOST = 'mod'

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

const VOICE_REL = path.join('role-card', 'neuro', 'voice', 'gpt-sovits')

export function getVoiceRoot(): string {
  return path.join(getModRoot(), VOICE_REL)
}

export function resolveVoicePath(relOrAbs: string): string {
  if (!relOrAbs) return ''
  if (path.isAbsolute(relOrAbs)) return relOrAbs
  return path.join(getVoiceRoot(), relOrAbs)
}

export { CUSTOM_SCHEME, MOD_HOST }
