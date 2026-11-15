import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getAttachmentsRoot, toAttachmentUrl } from './paths'

/** 图片以文件躺在 data/attachments，库里只留这个前缀的引用。 */
export const ATTACHMENT_PREFIX = 'opengal://attachments/'

const DATA_URL_RE = /data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)/g
// 用户附件在渲染层已限 8MB；这里放宽，兜住工具截图
const MAX_BYTES = 24 * 1024 * 1024
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

// 内容寻址：同一张图重复粘贴只落一份文件
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

/**
 * 把 JSON 里的 base64 图片换成附件引用。
 * 在写库前调用：不管图片来自附件、工具截图还是导入，都走同一个口子。
 */
export function externalizeDataUrls(json: string, root = getAttachmentsRoot()): string {
  if (!json.includes('data:image/')) return json
  return json.replace(DATA_URL_RE, (whole, ext: string, base64: string) => {
    try {
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return whole
      return toAttachmentUrl(writeAttachment(bytes, ext, root))
    } catch {
      return whole
    }
  })
}

export function externalizeMessage<T>(message: T, root = getAttachmentsRoot()): T {
  const json = JSON.stringify(message)
  const next = externalizeDataUrls(json, root)
  return next === json ? message : (JSON.parse(next) as T)
}

const ATTACHMENT_RE = new RegExp(`"${ATTACHMENT_PREFIX}([^"]+)"`, 'g')

async function readAsDataUrl(encoded: string, root: string): Promise<string | null> {
  const base = path.resolve(root)
  const file = path.resolve(base, decodeURIComponent(encoded))
  if (!file.startsWith(base + path.sep)) return null
  try {
    const bytes = await fs.promises.readFile(file)
    const mime = MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** 调模型前把附件引用换回 data URL：接口只接受 data URL 或公网地址。 */
export async function inlineAttachments<T>(value: T, root = getAttachmentsRoot()): Promise<T> {
  const json = JSON.stringify(value)
  if (!json.includes(ATTACHMENT_PREFIX)) return value

  const names = [
    ...new Set(
      [...json.matchAll(ATTACHMENT_RE)].map((m) => m[1]).filter((n): n is string => Boolean(n)),
    ),
  ]
  const replacements = new Map<string, string>()
  await Promise.all(
    names.map(async (name) => {
      const url = await readAsDataUrl(name, root)
      if (url) replacements.set(name, JSON.stringify(url))
    }),
  )
  if (replacements.size === 0) return value
  const next = json.replace(ATTACHMENT_RE, (whole, encoded: string) => replacements.get(encoded) ?? whole)
  return next === json ? value : (JSON.parse(next) as T)
}
