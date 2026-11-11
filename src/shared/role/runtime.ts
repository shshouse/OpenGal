export type RoleRunningMap = Record<string, boolean>

export function isRoleRunning(
  running: RoleRunningMap | undefined,
  roleId: string | null,
): boolean {
  return Boolean(roleId && running?.[roleId])
}

export function toggleRoleRunning(
  running: RoleRunningMap | undefined,
  roleId: string | null,
): RoleRunningMap {
  if (!roleId) return running ?? {}
  return { ...(running ?? {}), [roleId]: !running?.[roleId] }
}
