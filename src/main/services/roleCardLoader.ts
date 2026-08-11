/**
 * 角色卡加载器：扫描 mods/role-card 下每个子目录的 character.json，验证 + 归一化后返回。
 *
 * - 仅识别 character.json（M2 阶段不支持 yaml；后续可加导入工具把旧格式转 json）
 * - 目录名作为回退 id（character.json 里的 id 字段缺失时启用）
 * - 加载失败不抛错，记入日志后跳过该卡，保证一张坏卡不影响其它角色可用
 */

import fs from 'node:fs'
import path from 'node:path'
import type { RoleCard, RoleCardEntry } from '@shared/types'
import { getModRoot } from './paths'

const ROLE_CARD_DIR_REL = 'Role'
const CARD_FILE = 'character.json'

function getRoleCardRoot(): string {
  return path.join(getModRoot(), ROLE_CARD_DIR_REL)
}

function normalizeEntry(folderName: string, rootPath: string, raw: unknown): RoleCardEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const card = raw as Partial<RoleCard>
  if (!card.name || typeof card.name !== 'string') return null
  if (!card.persona || typeof card.persona !== 'object') return null
  if (!card.performance || typeof card.performance !== 'object') return null

  const id = (typeof card.id === 'string' && card.id) || folderName
  return {
    id,
    name: card.name,
    displayName: card.displayName,
    color: card.color,
    language: card.language,
    windowMode: card.windowMode ?? 'pet',
    performance: card.performance,
    voice: card.voice,
    asr: card.asr,
    llm: card.llm,
    persona: {
      description: card.persona.description ?? '',
      personality: card.persona.personality ?? '',
      scenario: card.persona.scenario,
      rules: card.persona.rules,
      userIdentity: card.persona.userIdentity,
      userTerm: card.persona.userTerm,
    },
    rootPath,
    folderName,
    builtin: true,
  }
}

export function listRoleCards(): RoleCardEntry[] {
  const root = getRoleCardRoot()
  if (!fs.existsSync(root)) return []

  const entries: RoleCardEntry[] = []
  for (const folder of fs.readdirSync(root, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue
    const folderPath = path.join(root, folder.name)
    const cardPath = path.join(folderPath, CARD_FILE)
    if (!fs.existsSync(cardPath)) continue

    try {
      const raw = JSON.parse(fs.readFileSync(cardPath, 'utf-8')) as unknown
      const entry = normalizeEntry(folder.name, folderPath, raw)
      if (entry) entries.push(entry)
      else console.warn(`[roleCardLoader] invalid card: ${cardPath}`)
    } catch (err) {
      console.error(`[roleCardLoader] failed to load ${cardPath}:`, err)
    }
  }
  return entries
}

export function getRoleCard(id: string): RoleCardEntry | null {
  return listRoleCards().find((c) => c.id === id) ?? null
}

/**
 * 解析角色卡 voice configRef 指向的 voice 配置文件（如 gpt-sovits 的 config.json）。
 * 返回原始 JSON 对象，由各 TTS 适配器自行解释字段。
 */
export function readRoleVoiceConfig(card: RoleCardEntry): Record<string, unknown> | null {
  if (!card.voice?.configRef) return null
  const abs = path.isAbsolute(card.voice.configRef)
    ? card.voice.configRef
    : path.join(card.rootPath, card.voice.configRef)
  if (!fs.existsSync(abs)) return null
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    console.error(`[roleCardLoader] failed to read voice config ${abs}:`, err)
    return null
  }
}

/**
 * 把角色卡 voice 配置中 model/audio 的相对路径解析为绝对路径。
 * 各角色卡的 model/audio 文件位于角色目录下，而非全局 voice 根目录。
 */
export function resolveRoleVoiceFile(card: RoleCardEntry, relOrAbs: string): string {
  if (!relOrAbs) return ''
  if (path.isAbsolute(relOrAbs)) return relOrAbs
  // 优先相对 voice 配置文件目录，否则相对角色根目录
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
