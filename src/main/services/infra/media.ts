import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getAttachmentsRoot, modUrlToAbsPath, toAttachmentUrl, toRoleUrl } from './paths'
import { resolveRoleDbDir } from '../memory/db/core'

export const ATTACHMENT_PREFIX = 'opengal://attachments/'
export const SELF_ATTACHMENT_PREFIX = 'opengal://self-attachments/'
const ROLE_ATTACHMENT_URL_RE = /"opengal:\/\/(?:attachments|roles)\/([^"]+)"/g

const DATA_URL_RE = /data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)/g
const MAX_BYTES = 24 * 1024 * 1024
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

function writeAttachment(bytes: Buffer, ext: string, root: string): string {
  const hash = crypto.createHash('sha1').update(bytes).digest('hex')
  const name = `${hash}.${ext === 'jpeg' ? 'jpg' : ext}`
  const file = path.join(root, name)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(file, bytes)
  }
  return name
}

export function externalizeDataUrls(
  json: string,
  root = getAttachmentsRoot(),
  buildUrl: (fileName: string) => string = toAttachmentUrl,
): string {
  if (!json.includes('data:image/')) return json
  return json.replace(DATA_URL_RE, (whole, ext: string, base64: string) => {
    try {
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return whole
      return buildUrl(writeAttachment(bytes, ext, root))
    } catch {
      return whole
    }
  })
}

export function externalizeMessage<T>(message: T, root = getAttachmentsRoot()): T {
  const json = JSON.stringify(message)
  const next = externalizeDataUrls(json, root, toAttachmentUrl)
  return next === json ? message : (JSON.parse(next) as T)
}

/** 角色消息图片写入该角色专属目录，库内只存去目录名的相对引用，目录重命名或迁移图片不失效 */
export function externalizeRoleMessage<T>(roleId: string, message: T): T {
  const { roleDir } = resolveRoleDbDir(roleId)
  const attachDir = path.join(roleDir, 'attachments')
  let json = JSON.stringify(message)
  const roleUrlPrefix = `${toRoleUrl(attachDir)}/`
  if (json.includes(roleUrlPrefix)) {
    json = json.split(roleUrlPrefix).join(SELF_ATTACHMENT_PREFIX)
  }
  const next = externalizeDataUrls(
    json,
    attachDir,
    (fileName) => `${SELF_ATTACHMENT_PREFIX}${encodeURIComponent(fileName)}`,
  )
  return next === json ? message : (JSON.parse(next) as T)
}

export function hydrateRoleMessageUrls<T>(roleId: string, message: T): T {
  const json = JSON.stringify(message)
  if (!json.includes(SELF_ATTACHMENT_PREFIX)) return message
  const { roleDir } = resolveRoleDbDir(roleId)
  const roleAttachPrefix = `${toRoleUrl(path.join(roleDir, 'attachments'))}/`
  const next = json.split(SELF_ATTACHMENT_PREFIX).join(roleAttachPrefix)
  return JSON.parse(next) as T
}

async function readFileAsDataUrl(file: string): Promise<string | null> {
  try {
    const bytes = await fs.promises.readFile(file)
    const mime =
      MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

async function readRelativeAsDataUrl(encoded: string, root: string): Promise<string | null> {
  const base = path.resolve(root)
  const file = path.resolve(base, decodeURIComponent(encoded))
  if (!file.startsWith(base + path.sep)) return null
  return readFileAsDataUrl(file)
}

export async function inlineAttachments<T>(
  value: T,
  root?: string,
): Promise<T> {
  const json = JSON.stringify(value)
  if (!json.includes('opengal://')) return value

  if (root) {
    const legacyRe = new RegExp(`"${ATTACHMENT_PREFIX}([^"]+)"`, 'g')
    const names = [
      ...new Set(
        [...json.matchAll(legacyRe)].map((m) => m[1]).filter((n): n is string => Boolean(n)),
      ),
    ]
    const replacements = new Map<string, string>()
    await Promise.all(
      names.map(async (name) => {
        const url = await readRelativeAsDataUrl(name, root)
        if (url) replacements.set(name, JSON.stringify(url))
      }),
    )
    if (replacements.size === 0) return value
    const next = json.replace(
      legacyRe,
      (whole, encoded: string) => replacements.get(encoded) ?? whole,
    )
    return next === json ? value : (JSON.parse(next) as T)
  }

  const urls = [
    ...new Set(
      [...json.matchAll(ROLE_ATTACHMENT_URL_RE)].map((m) => m[0].slice(1, -1)),
    ),
  ]
  if (urls.length === 0) return value
  const replacements = new Map<string, string>()
  await Promise.all(
    urls.map(async (fullUrl) => {
      const abs = modUrlToAbsPath(fullUrl)
      if (!abs) return
      const dataUrl = await readFileAsDataUrl(abs)
      if (dataUrl) replacements.set(JSON.stringify(fullUrl), JSON.stringify(dataUrl))
    }),
  )
  if (replacements.size === 0) return value
  let next = json
  for (const [from, to] of replacements.entries()) {
    next = next.split(from).join(to)
  }
  return next === json ? value : (JSON.parse(next) as T)
}
