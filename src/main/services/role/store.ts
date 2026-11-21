import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createDefaultRoleSummary, type RoleMode } from '@core/role/types'
import type { RolePersona } from '@shared/types'

const ROLES_DIR = 'roles'
const META_FILE = 'meta.json'
const SUMMARY_FILE = 'summary.json'
// 副本是新角色实例：记忆库与聊天附件不随目录复制。
// 活动中的 SQLite 文件带 -wal/-shm，直接拷贝也可能不一致。
const COPY_SKIP_ENTRIES = new Set([
  'memory.db',
  'memory.db-wal',
  'memory.db-shm',
  'logs',
  'attachments',
  SUMMARY_FILE,
])
const LF = String.fromCharCode(10)

export interface RoleMeta {
  roleId?: string
  templateId: string
  templateFolder: string
  templateVersion: string | null
  displayName: string
  mode?: RoleMode
  createdAt: string
}

export interface RoleFolder {
  name: string
  rootPath: string
}

export interface BlankRoleInput {
  name: string
  displayName?: string
  color?: string
  language?: string
  mode?: RoleMode
  greeting?: string
  persona: RolePersona
}

export function getRolesRoot(dataRoot: string): string {
  return path.join(dataRoot, ROLES_DIR)
}

export function ensureRolesRoot(dataRoot: string): string {
  const root = getRolesRoot(dataRoot)
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function listRoleFolders(dataRoot: string): RoleFolder[] {
  const root = getRolesRoot(dataRoot)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_system')
    .map((entry) => ({ name: entry.name, rootPath: path.join(root, entry.name) }))
}

function stripControlChars(input: string): string {
  return Array.from(input)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
}

// Windows 文件名禁用字符与结尾的点、空格；角色名允许中文和内部空格
export function sanitizeFolderName(name: string): string {
  const cleaned = stripControlChars(name)
    .replace(/[/:*?"<>|\\]/g, '_')
    .trim()
  return cleaned.replace(/[. ]+$/g, '')
}

export function allocateRoleFolder(dataRoot: string, displayName: string): string {
  const base = sanitizeFolderName(displayName)
  if (!base) throw new Error('角色名称无效')
  let folderName = base
  let sequence = 2
  while (isFolderNameTaken(dataRoot, folderName)) {
    folderName = `${base} ${sequence}`
    sequence++
  }
  return folderName
}

export function isFolderNameTaken(dataRoot: string, name: string): boolean {
  const folder = sanitizeFolderName(name)
  if (!folder) return true
  return fs.existsSync(path.join(getRolesRoot(dataRoot), folder))
}

function existingRoleIds(dataRoot: string): Set<string> {
  const ids = new Set<string>()
  for (const folder of listRoleFolders(dataRoot)) {
    ids.add(folder.name)
    for (const fileName of ['opengal.json', 'role.json', META_FILE]) {
      const full = path.join(folder.rootPath, fileName)
      if (!fs.existsSync(full)) continue
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf-8')) as { id?: unknown; roleId?: unknown }
        if (typeof raw.id === 'string' && raw.id.trim()) ids.add(raw.id.trim())
        if (typeof raw.roleId === 'string' && raw.roleId.trim()) ids.add(raw.roleId.trim())
      } catch {
        continue
      }
    }
  }
  return ids
}

export function allocateUniqueRoleId(dataRoot: string, preferredBase: string): string {
  const taken = existingRoleIds(dataRoot)
  const slug = preferredBase
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  const base = slug && /^[a-z0-9]/.test(slug) ? slug : `role-${randomBytes(3).toString('hex')}`
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${randomBytes(4).toString('hex')}`
}

function patchMaterializedCardFile(
  roleDir: string,
  patch: { id: string; displayName: string; mode?: RoleMode },
): void {
  const manifestPath = path.join(roleDir, 'opengal.json')
  const cardPath = path.join(roleDir, 'role.json')
  const targetFile = fs.existsSync(manifestPath)
    ? manifestPath
    : fs.existsSync(cardPath)
      ? cardPath
      : null
  if (!targetFile) return
  try {
    const raw = JSON.parse(fs.readFileSync(targetFile, 'utf-8')) as Record<string, unknown>
    raw.id = patch.id
    raw.displayName = patch.displayName
    if (patch.mode) raw.mode = patch.mode
    fs.writeFileSync(targetFile, JSON.stringify(raw, null, 2) + LF, 'utf-8')
  } catch {
    // 模板清单损坏时由后续加载校验报错
  }
}

function ensureSelfContainedSubdirs(roleDir: string): void {
  fs.mkdirSync(path.join(roleDir, 'attachments'), { recursive: true })
  fs.mkdirSync(path.join(roleDir, 'logs'), { recursive: true })
  const summaryFile = path.join(roleDir, SUMMARY_FILE)
  if (!fs.existsSync(summaryFile)) {
    fs.writeFileSync(summaryFile, JSON.stringify(createDefaultRoleSummary(), null, 2), 'utf-8')
  }
}

function copyDirectorySync(
  srcDir: string,
  destDir: string,
  skipTopLevel?: ReadonlySet<string>,
): void {
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skipTopLevel?.has(entry.name)) continue
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      copyDirectorySync(srcPath, destPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// 复制模板目录后写独立 roleId 与 meta：角色完整落入 data/roles，模组卸载后角色依然独立可用
export function materializeRole(
  dataRoot: string,
  templateDir: string,
  displayName: string,
  template: { id: string; folder: string; version?: string | null },
  opts: { roleId?: string; mode?: RoleMode } = {},
): string {
  const folder = sanitizeFolderName(displayName)
  if (!folder) throw new Error('角色名不能为空')
  const target = path.join(ensureRolesRoot(dataRoot), folder)
  if (fs.existsSync(target)) throw new Error(`角色目录已存在：${folder}`)
  const roleId = opts.roleId ?? allocateUniqueRoleId(dataRoot, template.id)
  copyDirectorySync(templateDir, target, COPY_SKIP_ENTRIES)
  patchMaterializedCardFile(target, { id: roleId, displayName, mode: opts.mode })
  ensureSelfContainedSubdirs(target)
  writeRoleMeta(target, {
    roleId,
    templateId: template.id,
    templateFolder: template.folder,
    templateVersion: template.version ?? null,
    displayName,
    ...(opts.mode ? { mode: opts.mode } : {}),
  })
  return target
}

function buildPlaceholderPortraitSvg(label: string, accent = '#3B82F6'): string {
  const safeChar = (label.trim()[0] ?? 'R').replace(/[<>&"']/g, '')
  const safeColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent) ? accent : '#3B82F6'
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768" viewBox="0 0 512 768">',
    '  <rect width="512" height="768" rx="48" fill="none"/>',
    `  <circle cx="256" cy="248" r="96" fill="${safeColor}" fill-opacity="0.18" stroke="${safeColor}" stroke-width="4"/>`,
    `  <path d="M116 640c0-88 62-152 140-152s140 64 140 152" fill="${safeColor}" fill-opacity="0.14" stroke="${safeColor}" stroke-width="4" stroke-linecap="round"/>`,
    `  <text x="256" y="276" text-anchor="middle" font-family="sans-serif" font-size="76" font-weight="600" fill="${safeColor}">${safeChar}</text>`,
    '</svg>',
  ].join(LF)
}

export function writeRoleMeta(rootPath: string, meta: Omit<RoleMeta, 'createdAt'>): void {
  const savedMeta = { ...meta, roleId: readDeclaredRoleId(rootPath) ?? meta.roleId, createdAt: new Date().toISOString() }
  fs.writeFileSync(path.join(rootPath, META_FILE), JSON.stringify(savedMeta, null, 2), 'utf-8')
}

export function createBlankRoleDir(
  dataRoot: string,
  input: BlankRoleInput,
): { roleId: string; folderName: string; rootPath: string } {
  const baseFolder = sanitizeFolderName(input.displayName?.trim() || input.name.trim())
  if (!baseFolder) throw new Error('角色名称无效')

  const folderName = allocateRoleFolder(dataRoot, baseFolder)

  const roleId = allocateUniqueRoleId(dataRoot, input.name)
  const rootPath = path.join(ensureRolesRoot(dataRoot), folderName)
  const spritesDir = path.join(rootPath, 'sprites')
  fs.mkdirSync(spritesDir, { recursive: true })
  ensureSelfContainedSubdirs(rootPath)

  const color = input.color && input.color.trim() ? input.color.trim() : '#3B82F6'
  fs.writeFileSync(
    path.join(spritesDir, 'idle.svg'),
    buildPlaceholderPortraitSvg(input.displayName || input.name, color),
    'utf-8',
  )

  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    id: roleId,
    name: input.name.trim(),
    displayName: input.displayName?.trim() || input.name.trim(),
    color,
    ...(input.language?.trim() ? { language: input.language.trim() } : {}),
    mode: input.mode ?? 'agent',
    windowMode: 'mate',
    ...(input.greeting?.trim() ? { greeting: input.greeting.trim() } : {}),
    performance: {
      mode: 'sprite',
      sprite: {
        spriteDir: 'sprites',
        defaultSprite: 'idle.svg',
      },
    },
    persona: input.persona,
  }
  fs.writeFileSync(path.join(rootPath, 'opengal.json'), JSON.stringify(manifest, null, 2) + LF, 'utf-8')

  writeRoleMeta(rootPath, {
    roleId,
    templateId: 'custom',
    templateFolder: '',
    templateVersion: null,
    displayName: input.displayName?.trim() || input.name.trim(),
    mode: input.mode ?? 'agent',
  })

  return { roleId, folderName, rootPath }
}

function readDeclaredRoleId(rootPath: string): string | null {
  for (const fileName of ['opengal.json', 'role.json', META_FILE]) {
    const full = path.join(rootPath, fileName)
    if (!fs.existsSync(full)) continue
    try {
      const raw = JSON.parse(fs.readFileSync(full, 'utf-8')) as { id?: unknown; roleId?: unknown }
      if (typeof raw.id === 'string' && raw.id.trim()) return raw.id.trim()
      if (typeof raw.roleId === 'string' && raw.roleId.trim()) return raw.roleId.trim()
    } catch {
      continue
    }
  }
  return null
}

/**
 * 同机手动复制 data/roles/<目录> 会导致两个文件夹携带相同 id。
 * 扫描时自动保留原始目录的 id，并为复制出来的副本分配独立 id（库内无 role_id 绑定，记忆与历史零损耗独立运行）。
 */
export function reconcileDuplicateRoleIds(
  dataRoot: string,
): Array<{ folderName: string; previousId: string; assignedId: string }> {
  const folders = listRoleFolders(dataRoot)
  const groups = new Map<string, Array<{ folder: RoleFolder; meta: RoleMeta | null; birthMs: number }>>()

  for (const folder of folders) {
    const id = readDeclaredRoleId(folder.rootPath)
    if (!id) continue
    const meta = readRoleMeta(folder.rootPath)
    let birthMs = Number.MAX_SAFE_INTEGER
    try {
      const parsedCreated = meta?.createdAt ? Date.parse(meta.createdAt) : Number.NaN
      const stat = fs.statSync(folder.rootPath)
      birthMs = Number.isFinite(parsedCreated) ? parsedCreated : stat.birthtimeMs || stat.mtimeMs
    } catch {
      /* keep fallback */
    }
    const list = groups.get(id) ?? []
    list.push({ folder, meta, birthMs })
    groups.set(id, list)
  }

  const reassigned: Array<{ folderName: string; previousId: string; assignedId: string }> = []
  for (const [id, entries] of groups.entries()) {
    if (entries.length <= 1) continue
    entries.sort((a, b) => {
      const aMatchesDisplay = a.meta?.displayName === a.folder.name ? 0 : 1
      const bMatchesDisplay = b.meta?.displayName === b.folder.name ? 0 : 1
      if (aMatchesDisplay !== bMatchesDisplay) return aMatchesDisplay - bMatchesDisplay
      const aMatchesId = a.folder.name === id ? 0 : 1
      const bMatchesId = b.folder.name === id ? 0 : 1
      if (aMatchesId !== bMatchesId) return aMatchesId - bMatchesId
      if (a.birthMs !== b.birthMs) return a.birthMs - b.birthMs
      return a.folder.name.localeCompare(b.folder.name)
    })

    for (const duplicate of entries.slice(1)) {
      const newId = allocateUniqueRoleId(dataRoot, id)
      const displayName = duplicate.folder.name
      patchMaterializedCardFile(duplicate.folder.rootPath, { id: newId, displayName })
      const nextMeta: RoleMeta = {
        roleId: newId,
        templateId: duplicate.meta?.templateId ?? id,
        templateFolder: duplicate.meta?.templateFolder ?? duplicate.folder.name,
        templateVersion: duplicate.meta?.templateVersion ?? null,
        displayName,
        ...(duplicate.meta?.mode ? { mode: duplicate.meta.mode } : {}),
        createdAt: new Date().toISOString(),
      }
      fs.writeFileSync(
        path.join(duplicate.folder.rootPath, META_FILE),
        JSON.stringify(nextMeta, null, 2),
        'utf-8',
      )
      reassigned.push({ folderName: duplicate.folder.name, previousId: id, assignedId: newId })
    }
  }
  return reassigned
}

export function findRoleFolderById(dataRoot: string, roleId: string): RoleFolder | null {
  reconcileDuplicateRoleIds(dataRoot)
  for (const folder of listRoleFolders(dataRoot)) {
    const declared = readDeclaredRoleId(folder.rootPath)
    if (declared === roleId) return folder
  }
  for (const folder of listRoleFolders(dataRoot)) {
    if (folder.name === roleId) return folder
  }
  return null
}

export function readRoleMeta(rootPath: string): RoleMeta | null {
  const file = path.join(rootPath, META_FILE)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as RoleMeta
  } catch {
    return null
  }
}
