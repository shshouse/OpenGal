const cache = new Map<string, string | null>()

export function getMemorySnapshot(characterId: string): string | null | undefined {
  return cache.get(characterId)
}

export function setMemorySnapshot(characterId: string, block: string | null): void {
  cache.set(characterId, block)
}
