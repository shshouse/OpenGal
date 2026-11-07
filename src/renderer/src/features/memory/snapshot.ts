const cache = new Map<string, string | null>()

export function getMemorySnapshot(roleId: string): string | null | undefined {
  return cache.get(roleId)
}

export function setMemorySnapshot(roleId: string, block: string | null): void {
  cache.set(roleId, block)
}
