export interface RoleAvatarRegion {
  x: number
  y: number
  radius: number
}
export interface AvatarCropPixels { x: number; y: number; size: number }
export function clampAvatarRegion(region: RoleAvatarRegion, aspectRatio: number): RoleAvatarRegion {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return { x: 0.5, y: 0.5, radius: 0 }
  const maxRadius = Math.min(0.5, aspectRatio / 2)
  const radius = Math.max(0, Math.min(maxRadius, Number.isFinite(region.radius) ? region.radius : 0))
  const ry = radius / aspectRatio
  return {
    x: Math.max(radius, Math.min(1 - radius, Number.isFinite(region.x) ? region.x : 0.5)),
    y: Math.max(ry, Math.min(1 - ry, Number.isFinite(region.y) ? region.y : 0.5)),
    radius,
  }
}
export function avatarCropPixels(region: RoleAvatarRegion, width: number, height: number): AvatarCropPixels {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, size: 0 }
  const safe = clampAvatarRegion(region, width / height)
  const size = Math.round(safe.radius * 2 * width)
  return { x: Math.round(safe.x * width - size / 2), y: Math.round(safe.y * height - size / 2), size }
}
