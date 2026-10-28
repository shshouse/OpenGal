export type CharacterRunningMap = Record<string, boolean>

export function isCharacterRunning(
  running: CharacterRunningMap | undefined,
  characterId: string | null,
): boolean {
  return Boolean(characterId && running?.[characterId])
}

export function toggleCharacterRunning(
  running: CharacterRunningMap | undefined,
  characterId: string | null,
): CharacterRunningMap {
  if (!characterId) return running ?? {}
  return { ...(running ?? {}), [characterId]: !running?.[characterId] }
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
