import type { RoleCardEntry } from '@shared/types'
import { getDataRoot } from '../infra/paths'
import { getRoleCard } from './cardLoader'
import { isFolderNameTaken, materializeRole } from './store'

const MAX_NAME = 64

/** 市场模板直接编辑会污染模板；复制成 data/roles 下的玩家角色后再改。 */
export function createRoleCopy(roleId: string, requestedName?: string): RoleCardEntry {
  const source = getRoleCard(roleId)
  if (!source) throw new Error('找不到这个角色')
  if (!source.builtin) throw new Error('这个角色已经可以编辑，不需要再复制')

  const baseName = (requestedName?.trim() || `${source.displayName ?? source.name}（我的）`).slice(0, MAX_NAME)
  const dataRoot = getDataRoot()
  let name = baseName
  let suffix = 2
  while (isFolderNameTaken(dataRoot, name)) {
    name = `${baseName} ${suffix++}`.slice(0, MAX_NAME)
  }

  materializeRole(dataRoot, source.rootPath, name, {
    id: source.id,
    folder: source.folderName,
    version: null,
  })

  const copied = getRoleCard(roleId)
  if (!copied) throw new Error('副本创建后无法读取，请检查角色目录')
  // 副本沿用原角色 id，记忆和聊天记录随角色一起保留
  return copied
}
