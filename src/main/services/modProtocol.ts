import { protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { CUSTOM_SCHEME, modUrlToAbsPath } from './paths'

const MIME_MAP: Record<string, string> = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.moc3': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.txt': 'text/plain'
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

/**
 * Must be called BEFORE app.whenReady() to privilege the scheme so it can be
 * treated as standard/secure and used with fetch/XHR by the renderer.
 */
export function registerModProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CUSTOM_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

/**
 * Must be called AFTER app.whenReady() to wire up the handler.
 */
export function registerModProtocolHandler(): void {
  protocol.handle(CUSTOM_SCHEME, async (request) => {
    const absPath = modUrlToAbsPath(request.url)
    if (!absPath) {
      return new Response('Invalid path', { status: 400 })
    }
    if (!fs.existsSync(absPath)) {
      return new Response('Not found', { status: 404 })
    }
    const body = fs.readFileSync(absPath)
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': mimeFromPath(absPath),
        'Content-Length': String(body.byteLength),
        'Access-Control-Allow-Origin': '*'
      }
    })
  })
}
