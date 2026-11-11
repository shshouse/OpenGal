import fs from 'node:fs'
import path from 'node:path'
import type { RoleCardEntry } from '@shared/types'
import { validateRoleCard, type RoleCardIssue } from '@shared/role/cardSchema'
import { getDataRoot, getModRoot, toRoleUrl, toModUrl } from './paths'
import { getRolesRoot } from './roleStore'

const ROLE_CARD_DIR_REL = 'Role'
const CARD_FILE = 'role.json'
const MANIFEST_FILE = 'opengal.json'

interface CardRoot {
  root: string
  owned: boolean
}

// 已创建的角色优先，模组目录退化为创建时的模板来源
function getRoleCardRoots(): CardRoot[] {
  const roots: CardRoot[] = []
  const owned = getRolesRoot(getDataRoot())
  if (fs.existsSync(owned)) roots.push({ root: owned, owned: true })
  const templates = path.join(getModRoot(), ROLE_CARD_DIR_REL)
  if (fs.existsSync(templates)) roots.push({ root: templates, owned: false })
  return roots
}

export interface LoadedRoleCard {
  entry: RoleCardEntry
  issues: RoleCardIssue[]
}

// opengal.json 是模组的唯一清单；resources/describe 等分发字段不参与角色卡校验
function manifestToCard(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const manifest = raw as Record<string, unknown>
  const card: Record<string, unknown> = { ...manifest }
  for (const key of ['resources', 'describe', 'examples', 'greeting', 'license', 'credits', 'provenance']) {
    delete card[key]
  }
  const voice = card.voice as Record<string, unknown> | undefined
  if (voice && typeof voice.config === 'string') {
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
  const entry: RoleCardEntry = {
    ...result.card,
    rootPath,
    folderName,
    builtin: !owned,
  }
  const sprite = entry.performance.sprite
  if (sprite && entry.performance.mode === 'sprite') {
    const dir = path.resolve(rootPath, sprite.spriteDir)
    const frame = (name: string): string | undefined => {
      const file = path.resolve(dir, name)
      const relative = path.relative(rootPath, file)
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) return undefined
      return owned ? toRoleUrl(file) : toModUrl(file)
    }
    const idle = frame(sprite.defaultSprite)
    if (idle) entry.spriteFrames = {
      idle,
      blink: frame('blink.png'),
      talk: frame('talk.png'),
      blinkTalk: frame('blink-talk.png'),
      happy: frame('happy.png'),
      sad: frame('sad.png'),
    }
  }
  return { entry, issues: result.issues }
}

export function listRoleCardsDetailed(): LoadedRoleCard[] {
  const loaded: LoadedRoleCard[] = []
  const seen = new Set<string>()

  for (const { root, owned } of getRoleCardRoots()) {
    for (const folder of fs.readdirSync(root, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue
      const folderPath = path.join(root, folder.name)
      const manifestPath = path.join(folderPath, MANIFEST_FILE)
      const useManifest = fs.existsSync(manifestPath)
      const cardPath = useManifest ? manifestPath : path.join(folderPath, CARD_FILE)
      if (!fs.existsSync(cardPath)) continue

      try {
        const raw = JSON.parse(fs.readFileSync(cardPath, 'utf-8')) as unknown
        const source = useManifest ? manifestToCard(raw) : raw
        const result = normalizeEntry(folder.name, folderPath, source, owned)
        if (!result) continue
        // 已实体化的角色与来源模组同 id 时保留实体角色，模组只作为模板
        if (seen.has(result.entry.id)) continue
        seen.add(result.entry.id)
        for (const issue of result.issues) {
          if (issue.severity === 'warning') {
            console.warn(`[roleCardLoader] ${folder.name} ${issue.path}: ${issue.message}`)
          }
        }
        loaded.push(result)
      } catch (err) {
        console.error(`[roleCardLoader] failed to load ${cardPath}:`, err)
      }
    }
  }
  return loaded
}

export function listRoleCards(): RoleCardEntry[] {
  return listRoleCardsDetailed().map((item) => item.entry)
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
