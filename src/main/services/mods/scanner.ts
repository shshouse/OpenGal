import fs from 'node:fs'
import path from 'node:path'
import { detectModManifest, type DiscoveredModSummary, type ModCapability } from '@core/mods/manifest'
import { getModRoot } from '../infra/paths'

export interface DiscoveredModEntry extends DiscoveredModSummary {
  rootPath: string
  manifestPath: string | null
}

const LEGACY_CATEGORIES = new Set(['Role', 'TTS', 'STT'])

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function inferImplicitEngineMod(
  folderName: string,
  dirPath: string,
  hintCategory?: 'Role' | 'TTS' | 'STT',
): DiscoveredModEntry | null {
  const lower = folderName.toLowerCase()
  const capabilities: ModCapability[] = []
  if (hintCategory === 'TTS' || lower === 'genie' || lower.includes('gpt-sovits')) {
    capabilities.push('tts-engine')
  } else if (hintCategory === 'STT' || lower.includes('sherpa') || lower.includes('sense-voice')) {
    capabilities.push('asr-engine')
  }
  if (capabilities.length === 0) return null

  return {
    id: folderName,
    folderName,
    name: folderName,
    displayName: folderName,
    version: '1.0.0',
    capabilities,
    summary: capabilities.includes('tts-engine') ? '本地语音合成运行时模组' : '本地语音识别运行时模组',
    tags: [],
    hasVoice: false,
    rootPath: dirPath,
    manifestPath: null,
  }
}

function inspectModDir(
  folderName: string,
  dirPath: string,
  hintCategory?: 'Role' | 'TTS' | 'STT',
): DiscoveredModEntry | null {
  const opengalPath = path.join(dirPath, 'opengal.json')
  const pluginManifestPath = path.join(dirPath, 'manifest.json')
  const legacyCardPath = path.join(dirPath, 'role.json')

  const manifestFile = fs.existsSync(opengalPath)
    ? opengalPath
    : fs.existsSync(pluginManifestPath)
      ? pluginManifestPath
      : fs.existsSync(legacyCardPath)
        ? legacyCardPath
        : null

  if (manifestFile) {
    const raw = readJsonObject(manifestFile)
    const detected = detectModManifest(raw, folderName, hintCategory)
    if (detected) {
      return {
        ...detected,
        rootPath: dirPath,
        manifestPath: manifestFile,
      }
    }
  }

  return inferImplicitEngineMod(folderName, dirPath, hintCategory)
}

/**
 * 扫描 mods 根目录：优先识别扁平存放的 mods/<目录>/opengal.json，
 * 同时兼容存量分类目录 mods/Role|TTS|STT/<目录>，不移动或修改用户已有目录。
 */
export function scanMods(modRoot = getModRoot()): DiscoveredModEntry[] {
  if (!fs.existsSync(modRoot)) return []

  const results: DiscoveredModEntry[] = []
  const seenPaths = new Set<string>()

  let topDirs: fs.Dirent[]
  try {
    topDirs = fs.readdirSync(modRoot, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return []
  }

  for (const dir of topDirs) {
    const dirPath = path.join(modRoot, dir.name)
    if (LEGACY_CATEGORIES.has(dir.name)) {
      const category = dir.name as 'Role' | 'TTS' | 'STT'
      let subDirs: fs.Dirent[] = []
      try {
        subDirs = fs.readdirSync(dirPath, { withFileTypes: true }).filter((d) => d.isDirectory())
      } catch {
        subDirs = []
      }
      for (const sub of subDirs) {
        const subPath = path.join(dirPath, sub.name)
        const key = path.resolve(subPath)
        if (seenPaths.has(key)) continue
        const found = inspectModDir(sub.name, subPath, category)
        if (found) {
          seenPaths.add(key)
          results.push(found)
        }
      }
      continue
    }

    const key = path.resolve(dirPath)
    if (seenPaths.has(key)) continue
    const found = inspectModDir(dir.name, dirPath)
    if (found) {
      seenPaths.add(key)
      results.push(found)
    }
  }

  return results
}

export function listModsByCapability(capability: ModCapability, modRoot = getModRoot()): DiscoveredModEntry[] {
  return scanMods(modRoot).filter((mod) => mod.capabilities.includes(capability))
}
