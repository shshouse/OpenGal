import fs from 'node:fs'
import path from 'node:path'
import type { RoleCardEntry, RoleOutfitEntry, RoleSpriteConfig, SpriteFrames } from '@shared/types'
import { validateRoleCard, type RoleCardIssue } from '@shared/role/cardSchema'
import { getDataRoot, getModRoot, toRoleUrl, toModUrl } from '../infra/paths'
import { readRoleSummaryCache } from '../memory/store/roleState'
import { listModsByCapability } from '../mods/scanner'
import { getRolesRoot, readRoleMeta } from './store'

const CARD_FILE = 'role.json'
const MANIFEST_FILE = 'opengal.json'

export interface LoadedRoleCard {
  entry: RoleCardEntry
  issues: RoleCardIssue[]
}

// 仅剥离纯分发声明字段，保留 greeting / examples / describe / mode 供角色扮演锚定使用
function manifestToCard(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const manifest = raw as Record<string, unknown>
  const card: Record<string, unknown> = { ...manifest }
  for (const key of ['resources', 'license', 'credits', 'provenance']) {
    delete card[key]
  }
  const voice = card.voice as Record<string, unknown> | undefined
  if (voice && typeof voice.config === 'string' && voice.configRef === undefined) {
    card.voice = { ...voice, configRef: voice.config }
  }
  return card
}

function normalizeEntry(
  folderName: string,
  rootPath: string,
  raw: unknown,
  owned: boolean,
): LoadedRoleCard | null {
  const result = validateRoleCard(raw, folderName)
  if (!result.card) {
    const detail = result.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.path || '<root>'}: ${issue.message}`)
      .join('; ')
    console.warn(`[roleCardLoader] 角色卡校验失败 (${folderName}): ${detail || '未知原因'}`)
    return null
  }
  const meta = owned ? readRoleMeta(rootPath) : null
  const summary = owned ? readRoleSummaryCache(rootPath) : undefined
  const entry: RoleCardEntry = {
    ...result.card,
    rootPath,
    folderName,
    builtin: !owned,
    ...(meta?.templateId ? { templateId: meta.templateId } : {}),
    ...(summary ? { summary } : {}),
  }
  const sprite = entry.performance.sprite
  if (sprite && entry.performance.mode === 'sprite') {
    entry.spriteFrames = spriteFramesOf(rootPath, sprite, owned)
  }
  if (entry.performance.outfits) {
    const outfits: RoleOutfitEntry[] = []
    for (const outfit of entry.performance.outfits) {
      if (outfit.mode === 'sprite' && outfit.sprite) {
        const frames = spriteFramesOf(rootPath, outfit.sprite, owned)
        if (frames) outfits.push({ ...outfit, spriteFrames: frames })
        continue
      }
      if (outfit.mode === 'spine' && outfit.spine) {
        const skel = cardFileUrl(rootPath, outfit.spine.skelPath, owned)
        const atlas = cardFileUrl(rootPath, outfit.spine.atlasPath, owned)
        if (skel && atlas) outfits.push({ ...outfit, spineSkelUrl: skel, spineAtlasUrl: atlas })
      }
    }
    if (outfits.length) entry.outfitEntries = outfits
  }
  return { entry, issues: result.issues }
}

function cardFileUrl(rootPath: string, relPath: string, owned: boolean): string | undefined {
  const file = path.resolve(rootPath, relPath)
  const relative = path.relative(rootPath, file)
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) return undefined
  return owned ? toRoleUrl(file) : toModUrl(file)
}

function spriteFramesOf(rootPath: string, sprite: RoleSpriteConfig, owned: boolean): SpriteFrames | undefined {
  const dir = path.join(rootPath, sprite.spriteDir)
  const frame = (name: string): string | undefined => {
    const file = path.join(dir, name)
    const relative = path.relative(rootPath, file)
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) return undefined
    return owned ? toRoleUrl(file) : toModUrl(file)
  }
  const idle = frame(sprite.defaultSprite)
  if (!idle) return undefined
  return {
    idle,
    blink: frame('blink.png') ?? frame('blink.svg'),
    talk: frame('talk.png') ?? frame('talk.svg'),
    blinkTalk: frame('blink-talk.png'),
    happy: frame('happy.png'),
    sad: frame('sad.png'),
    ...(emotionFramesOf(rootPath, path.join(rootPath, sprite.spriteDir), owned) ?? {}),
  }
}

/** 约定目录 sprites/emotions/：文件名就是表情名，加一张图就多一种表情 */
function emotionFramesOf(
  rootPath: string,
  spriteDir: string,
  owned: boolean,
): { emotions?: Record<string, string> } | undefined {
  const dir = path.join(spriteDir, 'emotions')
  if (!fs.existsSync(dir)) return undefined
  const emotions: Record<string, string> = {}
  for (const file of fs.readdirSync(dir)) {
    if (!/\.png$/i.test(file)) continue
    const name = file.slice(0, -4).trim()
    if (!name) continue
    const url = cardFileUrl(rootPath, path.relative(rootPath, path.join(dir, file)), owned)
    if (url) emotions[name] = url
  }
  return Object.keys(emotions).length ? { emotions } : undefined
}

function loadCardFromFolder(folderName: string, folderPath: string, owned: boolean): LoadedRoleCard | null {
  const manifestPath = path.join(folderPath, MANIFEST_FILE)
  const useManifest = fs.existsSync(manifestPath)
  const cardPath = useManifest ? manifestPath : path.join(folderPath, CARD_FILE)
  if (!fs.existsSync(cardPath)) return null

  try {
    const raw = JSON.parse(fs.readFileSync(cardPath, 'utf-8')) as unknown
    const source = useManifest ? manifestToCard(raw) : raw
    const result = normalizeEntry(folderName, folderPath, source, owned)
    if (!result) return null
    for (const issue of result.issues) {
      if (issue.severity === 'warning') {
        console.warn(`[roleCardLoader] ${folderName} ${issue.path}: ${issue.message}`)
      }
    }
    return result
  } catch (err) {
    console.error(`[roleCardLoader] failed to load ${cardPath}:`, err)
    return null
  }
}

/** 仅加载玩家已在 data/roles 下创建的角色实例 */
export function listOwnedRoleCardsDetailed(dataRoot = getDataRoot()): LoadedRoleCard[] {
  const ownedRoot = getRolesRoot(dataRoot)
  if (!fs.existsSync(ownedRoot)) return []

  const loaded: LoadedRoleCard[] = []
  const seen = new Set<string>()
  for (const folder of fs.readdirSync(ownedRoot, { withFileTypes: true })) {
    if (!folder.isDirectory() || folder.name === '_system') continue
    const result = loadCardFromFolder(folder.name, path.join(ownedRoot, folder.name), true)
    if (!result || seen.has(result.entry.id)) continue
    seen.add(result.entry.id)
    loaded.push(result)
  }
  return loaded
}

export function listOwnedRoleCards(dataRoot = getDataRoot()): RoleCardEntry[] {
  return listOwnedRoleCardsDetailed(dataRoot).map((item) => item.entry)
}

/** 扫描 mods 下的角色模板（扁平 mods/<目录> 与存量 mods/Role/<目录> 均识别） */
export function listRoleTemplatesDetailed(modRoot = getModRoot()): LoadedRoleCard[] {
  const loaded: LoadedRoleCard[] = []
  const seen = new Set<string>()
  for (const mod of listModsByCapability('role-template', modRoot)) {
    const result = loadCardFromFolder(mod.folderName, mod.rootPath, false)
    if (!result || seen.has(result.entry.id)) continue
    seen.add(result.entry.id)
    loaded.push(result)
  }
  return loaded
}

export function listRoleTemplates(modRoot = getModRoot()): RoleCardEntry[] {
  return listRoleTemplatesDetailed(modRoot).map((item) => item.entry)
}

export function listRoleCardsDetailed(): LoadedRoleCard[] {
  const loaded: LoadedRoleCard[] = []
  const seen = new Set<string>()
  for (const item of [...listOwnedRoleCardsDetailed(), ...listRoleTemplatesDetailed()]) {
    if (seen.has(item.entry.id)) continue
    seen.add(item.entry.id)
    loaded.push(item)
  }
  return loaded
}

export function listRoleCards(): RoleCardEntry[] {
  return listRoleCardsDetailed().map((item) => item.entry)
}

export function getOwnedRoleCard(id: string, dataRoot = getDataRoot()): RoleCardEntry | null {
  return listOwnedRoleCards(dataRoot).find((c) => c.id === id) ?? null
}

export function getRoleCard(id: string): RoleCardEntry | null {
  return listRoleCards().find((c) => c.id === id) ?? null
}

export function readRoleVoiceConfig(card: RoleCardEntry): Record<string, unknown> | null {
  if (!card.voice?.configRef) return null
  const abs = path.isAbsolute(card.voice.configRef)
    ? card.voice.configRef
    : path.join(card.rootPath, card.voice.configRef)
  if (path.relative(card.rootPath, abs).startsWith('..')) return null
  if (!fs.existsSync(abs)) return null
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    console.error(`[roleCardLoader] failed to read voice config ${abs}:`, err)
    return null
  }
}

export function resolveRoleVoiceFile(card: RoleCardEntry, relOrAbs: string): string {
  if (!relOrAbs) return ''
  if (path.isAbsolute(relOrAbs)) return relOrAbs
  const voiceConfigRef = card.voice?.configRef
  if (voiceConfigRef) {
    const voiceConfigDir = path.dirname(
      path.isAbsolute(voiceConfigRef)
        ? voiceConfigRef
        : path.join(card.rootPath, voiceConfigRef),
    )
    const fromVoiceDir = path.join(voiceConfigDir, relOrAbs)
    if (fs.existsSync(fromVoiceDir)) return fromVoiceDir
  }
  return path.join(card.rootPath, relOrAbs)
}
