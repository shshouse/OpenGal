import type { RoleCardEntry, RoleMode } from '@shared/types'
import { getDataRoot } from '../infra/paths'
import { getOwnedRoleCard, getRoleCard, listRoleTemplatesDetailed } from './cardLoader'
import { allocateUniqueRoleId, isFolderNameTaken, materializeRole } from './store'

const MAX_NAME = 64

function pickFolderName(dataRoot: string, base: string): string {
  const clean = base.trim().slice(0, MAX_NAME)
  if (!clean) throw new Error('角色名称不能为空')
  if (!isFolderNameTaken(dataRoot, clean)) return clean

  for (let n = 2; n < 100; n++) {
    const candidate = `${clean} ${n}`.slice(0, MAX_NAME)
    if (!isFolderNameTaken(dataRoot, candidate)) return candidate
  }
  throw new Error('同名角色过多，请换一个名称')
}

/** 从模组模板或已有角色实例化独立角色目录（独立 ID、独立记忆库与资产副本） */
export function createRoleCopy(
  roleId: string,
  customName?: string,
  mode?: RoleMode,
  dataRoot = getDataRoot(),
): RoleCardEntry {
  // 模板优先：模组模板与已创建角色可能共用同一个 id，实例化必须取模组里的原始模板
  const source =
    listRoleTemplatesDetailed().find((item) => item.entry.id === roleId)?.entry ?? getRoleCard(roleId)
  if (!source) throw new Error('找不到要实例化的角色模板')

  const defaultBase = source.builtin
    ? (source.displayName ?? source.name)
    : `${source.displayName ?? source.name}（副本）`
  const name = pickFolderName(dataRoot, customName?.trim() || defaultBase)
  const newRoleId =
    typeof allocateUniqueRoleId === 'function'
      ? allocateUniqueRoleId(dataRoot, source.id)
      : source.id

  materializeRole(
    dataRoot,
    source.rootPath,
    name,
    {
      id: source.id,
      folder: source.folderName,
      version: null,
    },
    { roleId: newRoleId, ...(mode ? { mode } : {}) },
  )

  const created =
    (typeof getOwnedRoleCard === 'function' ? getOwnedRoleCard(newRoleId, dataRoot) : null) ??
    getRoleCard(newRoleId)
  if (!created) throw new Error('角色实例创建后无法读取，请检查角色目录')
  return created
}
