import { safeStorage, app } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getDataRoot, getModRoot } from './paths'
import { logBus } from './logBus'

function legacySources(): string[] {
  return [
    path.join(app.getPath('appData'), 'com.opengal.desktop'),
    app.getPath('userData')
  ]
}

export function migrateLegacyData(): void {
  try {
    const dataRoot = getDataRoot()
    migrateConfig(dataRoot)
    migrateChatHistory(dataRoot)
  } catch (err) {
    logBus.warn('config', `旧数据迁移失败（忽略，按全新数据继续）: ${(err as Error).message}`)
  }
}

function migrateConfig(dataRoot: string): void {
  const target = path.join(dataRoot, 'opengal-config.json')
  if (fs.existsSync(target)) return

  const candidates = legacySources()
    .map((dir) => {
      const file = path.join(dir, 'opengal-config.json')
      try {
        return { file, mtime: fs.statSync(file).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((c): c is { file: string; mtime: number } => c !== null)
    .sort((a, b) => b.mtime - a.mtime)
  if (candidates.length === 0) return

  const config = JSON.parse(
    fs.readFileSync(candidates[0].file, 'utf-8')
  ) as Record<string, unknown>
  for (const c of candidates.slice(1)) {
    try {
      mergeInto(config, JSON.parse(fs.readFileSync(c.file, 'utf-8')))
    } catch {
      // 候选损坏则跳过，不影响基底
    }
  }
  rewriteModelPaths(config)
  const llm = (config.llm ?? {}) as Record<string, unknown>
  const key = typeof llm.apiKey === 'string' ? llm.apiKey : ''
  if (key) {
    const plain = tryDecrypt(key)
    if (plain !== null) {
      llm.apiKey = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(plain).toString('base64')
        : plain
      logBus.info('config', `已迁移旧配置并保留 API Key: ${candidates[0].file}`)
    } else {
      llm.apiKey = ''
      logBus.warn('config', '旧配置已迁移，但 API Key 无法解密，请在设置里重新填写')
    }
  } else {
    logBus.info('config', `已迁移旧配置: ${candidates[0].file}`)
  }
  fs.mkdirSync(dataRoot, { recursive: true })
  fs.writeFileSync(target, JSON.stringify(config, null, 2), 'utf-8')
}

function rewriteModelPaths(config: Record<string, unknown>): void {
  const model = config.model as Record<string, unknown> | null | undefined
  if (!model || typeof model !== 'object') return
  const modRoot = getModRoot()
  for (const key of ['folderPath', 'modelPath']) {
    const value = model[key]
    if (typeof value !== 'string' || !value) continue
    const normalized = value.replace(/\\/g, '/')
    const idx = normalized.indexOf('/mods/')
    if (idx === -1) continue
    const rewritten = path.join(modRoot, normalized.slice(idx + '/mods/'.length))
    if (rewritten !== value && fs.existsSync(rewritten)) {
      model[key] = rewritten
    }
  }
  if (typeof model.modelUrl === 'string' && /^https?:\/\//.test(model.modelUrl)) {
    model.modelUrl = ''
  }
}

function tryDecrypt(value: string): string | null {
  if (!value) return null
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return dpapiUnprotect(value)
  }
}

function dpapiUnprotect(base64: string): string | null {
  if (process.platform !== 'win32') return null
  const script =
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
    'Add-Type -AssemblyName System.Security; ' +
    '$in = [Console]::In.ReadToEnd().Trim(); ' +
    'if ($in) { $b = [Convert]::FromBase64String($in); ' +
    '[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)) }'
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: base64,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true
    })
    const plain = out.trim()
    return plain || null
  } catch {
    return null
  }
}

function migrateChatHistory(dataRoot: string): void {
  const targetDir = path.join(dataRoot, 'chat_history')
  for (const dir of legacySources()) {
    const srcDir = path.join(dir, 'chat_history')
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(srcDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const target = path.join(targetDir, entry.name)
      if (fs.existsSync(target)) continue
      fs.mkdirSync(targetDir, { recursive: true })
      fs.copyFileSync(path.join(srcDir, entry.name), target)
      logBus.info('chat', `已迁移会话历史: ${entry.name}`)
    }
  }
}

function mergeInto(base: unknown, fallback: unknown): void {
  if (typeof base !== 'object' || base === null) return
  if (typeof fallback !== 'object' || fallback === null || Array.isArray(base)) return
  const target = base as Record<string, unknown>
  for (const [key, value] of Object.entries(fallback as Record<string, unknown>)) {
    const cur = target[key]
    if (cur === undefined || cur === null || cur === '') {
      target[key] = value
    } else {
      mergeInto(cur, value)
    }
  }
}
