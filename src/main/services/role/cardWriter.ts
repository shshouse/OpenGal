import fs from 'node:fs'
import path from 'node:path'
import { validateRoleCard } from '@shared/role/cardSchema'
import type { RoleCard, RoleCardEditableFields, RoleCardSaveResult } from '@shared/types'
import { getDataRoot } from '../infra/paths'
import { getRolesRoot } from './store'

const MANIFEST_FILE = 'opengal.json'
const CARD_FILE = 'role.json'

interface OwnedCardFile {
  file: string
  folderName: string
  raw: Record<string, unknown>
}

function readObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function findOwnedCard(roleId: string, dataRoot: string): OwnedCardFile {
  const root = getRolesRoot(dataRoot)
  if (!fs.existsSync(root)) {
    throw new Error('没有可编辑的角色，请先从角色市场创建一个角色')
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const folderPath = path.join(root, entry.name)
    const manifestPath = path.join(folderPath, MANIFEST_FILE)
    const cardPath = path.join(folderPath, CARD_FILE)
    const file = fs.existsSync(manifestPath) ? manifestPath : fs.existsSync(cardPath) ? cardPath : null
    if (!file) continue

    const raw = readObject(file)
    if (!raw) continue
    const result = validateRoleCard(raw, entry.name)
    if (result.card?.id === roleId) return { file, folderName: entry.name, raw }
  }

  throw new Error('这是市场模板，不能直接修改；请先从角色市场创建自己的角色')
}

function mergeCard(raw: Record<string, unknown>, fields: RoleCardEditableFields): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw }

  if (fields.displayName !== undefined) {
    const displayName = fields.displayName.trim()
    if (displayName) next.displayName = displayName
    else delete next.displayName
  }
  if (fields.color !== undefined) {
    if (fields.color) next.color = fields.color
    else delete next.color
  }
  if (fields.language !== undefined) {
    const language = fields.language.trim()
    if (language) next.language = language
    else delete next.language
  }

  const persona = raw.persona && typeof raw.persona === 'object' && !Array.isArray(raw.persona)
    ? raw.persona as Record<string, unknown>
    : {}
  next.persona = { ...persona, ...fields.persona }
  return next
}

function writeWithBackup(file: string, content: string): void {
  const backup = `${file}.bak`
  fs.copyFileSync(file, backup)

  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, content, 'utf-8')
  try {
    fs.renameSync(temporary, file)
  } catch {
    // Windows 在个别文件系统上不允许 rename 覆盖；备份已写入，退回直接覆盖
    fs.writeFileSync(file, content, 'utf-8')
    fs.rmSync(temporary, { force: true })
  }
}

export function saveRoleCard(
  roleId: string,
  fields: RoleCardEditableFields,
  dataRoot = getDataRoot(),
): RoleCardSaveResult {
  const found = findOwnedCard(roleId, dataRoot)
  const merged = mergeCard(found.raw, fields)
  const validation = validateRoleCard(merged, found.folderName)
  if (!validation.ok || !validation.card) {
    const detail = validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.path || '<root>'}：${issue.message}`)
      .join('；')
    throw new Error(`角色卡校验失败：${detail || '请检查填写内容'}`)
  }

  writeWithBackup(found.file, `${JSON.stringify(merged, null, 2)}\n`)
  return {
    card: validation.card as RoleCard,
    warnings: validation.issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => `${issue.path || '<root>'}：${issue.message}`),
  }
}
