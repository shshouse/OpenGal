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

export interface HeadCrop {
  x: number
  y: number
  size: number
}

export function getHeadCrop(width: number, height: number): HeadCrop {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, size: 0 }
  const size = Math.floor(Math.min(width * 0.22, height * 0.28))
  return {
    x: Math.max(0, Math.floor((width - size) / 2)),
    y: 0,
    size,
  }
}
