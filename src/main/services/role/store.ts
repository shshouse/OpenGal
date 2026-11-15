import fs from 'node:fs'
import path from 'node:path'

const ROLES_DIR = 'roles'
const META_FILE = 'meta.json'

export interface RoleMeta {
  templateId: string
  templateFolder: string
  templateVersion: string | null
  displayName: string
  createdAt: string
}

export interface RoleFolder {
  name: string
  rootPath: string
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
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, rootPath: path.join(root, entry.name) }))
}

// Windows 文件名禁用字符与结尾的点、空格；角色名允许中文和内部空格
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    // Windows 文件名不允许控制字符，必须显式过滤
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
  return cleaned.replace(/[. ]+$/g, '')
}

export function isFolderNameTaken(dataRoot: string, name: string): boolean {
  const folder = sanitizeFolderName(name)
  if (!folder) return true
  return fs.existsSync(path.join(getRolesRoot(dataRoot), folder))
}

// 复制模板目录后写 meta：meta 记录来源，角色卡本身不因模组消失而失效
export function materializeRole(
  dataRoot: string,
  templateDir: string,
  displayName: string,
  template: { id: string; folder: string; version?: string | null },
): string {
  const folder = sanitizeFolderName(displayName)
  if (!folder) throw new Error('角色名不能为空')
  const root = ensureRolesRoot(dataRoot)
  const target = path.join(root, folder)
  if (fs.existsSync(target)) throw new Error(`角色目录已存在：${folder}`)

  fs.cpSync(templateDir, target, { recursive: true, errorOnExist: false, force: false })

  const meta: RoleMeta = {
    templateId: template.id,
    templateFolder: template.folder,
    templateVersion: template.version ?? null,
    displayName,
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(target, META_FILE), JSON.stringify(meta, null, 2), 'utf-8')
  return target
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
