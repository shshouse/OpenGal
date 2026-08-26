/**
 * 一次性数据迁移：把散落在系统 AppData 的旧数据搬到便携数据根（copy 不删原件）。
 *
 * 触发条件：数据根下 opengal-config.json 不存在（首次用便携目录启动）。
 * 来源候选（按 mtime 最新者胜）：
 * - 旧 Electron（electron-store 默认位置）：userData/opengal-config.json
 * - 旧 Tauri 版：appData/com.opengal.desktop/opengal-config.json
 *
 * apiKey 密文兼容性：旧 Tauri 用裸 DPAPI blob，Electron safeStorage 是 v10 前缀
 * 格式；Chromium 解密对无前缀字节走 legacy CryptUnprotectData 直解，理论上互通。
 * 这里迁移时主动尝试解密并重加密成 v10，失败则清空并提示重填（幂等，不阻塞启动）。
 * chat_history 目录同理逐文件拷贝（目标已存在则跳过，不覆盖新数据）。
 */

import { safeStorage, app } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getDataRoot, getModRoot } from './paths'
import { logBus } from './logBus'

/** 旧数据可能的所在地（不同历史版本写过的位置）。 */
function legacySources(): string[] {
  return [
    path.join(app.getPath('appData'), 'com.opengal.desktop'), // 旧 Tauri 版
    app.getPath('userData') // 旧 Electron（electron-store 默认）
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
  if (fs.existsSync(target)) return // 已有数据，绝不覆盖

  // 按字段合并：最新那份做基底，它为空/缺失的字段由更旧的候选补上。
  // 整份选最新的做法会把「旧版独有的功能配置」（如 Electron 的 Vosk 路径，
  // Tauri 版没有 ASR、存的是空串）静默清掉，这里改为非空优先。
  const candidates = legacySources()
    .map((dir) => {
      const file = path.join(dir, 'opengal-config.json')
      try {
        return { file, mtime: fs.statSync(file).mtimeMs }
      } catch {
        return null // 不存在，跳过
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
      // 重加密成本机 safeStorage 格式，之后读写走正常路径
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

/**
 * 旧 Tauri 版写进配置的模型绝对路径穿过 OpenGal-Tauri 仓库（如
 * `...\OpenGal-Tauri\src-tauri\..\..\OpenGal\mods\Role\...`），仓库删除后路径失效。
 * 这里把 `/mods/` 之后的相对部分重挂到当前 mods 根；modelUrl 则清空，
 * 让 readConfig 按新路径重新生成（两版的 mod URL 协议格式不同）。
 */
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

/** 尝试把旧密文解回明文；失败返回 null（明文 / 空 / 跨机器密文都按失败处理）。 */
function tryDecrypt(value: string): string | null {
  if (!value) return null
  if (!safeStorage.isEncryptionAvailable()) return value // 一直没加密过，明文即原文
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    // 旧 Tauri 版存的是裸 DPAPI blob（无 safeStorage 的 v10 前缀），
    // 借 .NET ProtectedData 直解（同用户作用域），密文走 stdin 避免进命令行
    return dpapiUnprotect(value)
  }
}

/** PowerShell 调 .NET CryptUnprotectData；仅 Windows，一次性迁移用。 */
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
      continue // 不存在，跳过
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const target = path.join(targetDir, entry.name)
      if (fs.existsSync(target)) continue // 不覆盖新数据
      fs.mkdirSync(targetDir, { recursive: true })
      fs.copyFileSync(path.join(srcDir, entry.name), target)
      logBus.info('chat', `已迁移会话历史: ${entry.name}`)
    }
  }
}

/**
 * 把 fallback 的字段填进 base：只补 base 里 undefined / null / 空串的位置，
 * 递归对象；数组不合并（整体以最新为准）。用于多份旧配置的按字段合并。
 */
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
