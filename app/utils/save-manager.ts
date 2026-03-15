const SAVE_KEY = 'opengal_saves'
const QUICK_SAVE_KEY = 'opengal_quicksave'
const SETTINGS_KEY = 'opengal_settings'
const AFFINITY_KEY = 'opengal_affinity'

export interface SaveData {
  id: number
  sceneId: string
  dialogueIndex: number
  characterId: string
  timestamp: number
  label: string
  affinity: Record<string, number>
}

export interface GameSettings {
  textSpeed: number
  autoPlay: boolean
  selectedCharacterId: string
}

export interface AffinityData {
  [characterId: string]: number
}

function readJson<T>(key: string, fallback: T): T {
  if (import.meta.server) return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, data: unknown) {
  if (import.meta.server) return
  localStorage.setItem(key, JSON.stringify(data))
}

export function getSaves(): SaveData[] {
  return readJson<SaveData[]>(SAVE_KEY, [])
}

export function writeSave(save: Omit<SaveData, 'id' | 'timestamp'>): SaveData {
  const saves = getSaves()
  const entry: SaveData = {
    ...save,
    id: Date.now(),
    timestamp: Date.now(),
  }
  saves.push(entry)
  writeJson(SAVE_KEY, saves)
  return entry
}

export function deleteSave(id: number) {
  const saves = getSaves().filter((s) => s.id !== id)
  writeJson(SAVE_KEY, saves)
}

export function getQuickSave(): SaveData | null {
  return readJson<SaveData | null>(QUICK_SAVE_KEY, null)
}

export function writeQuickSave(save: Omit<SaveData, 'id' | 'timestamp'>) {
  const entry: SaveData = { ...save, id: -1, timestamp: Date.now() }
  writeJson(QUICK_SAVE_KEY, entry)
}

export function getSettings(): GameSettings {
  return readJson<GameSettings>(SETTINGS_KEY, {
    textSpeed: 40,
    autoPlay: false,
    selectedCharacterId: 'murasame',
  })
}

export function saveSettings(settings: GameSettings) {
  writeJson(SETTINGS_KEY, settings)
}

export function getAffinity(): AffinityData {
  return readJson<AffinityData>(AFFINITY_KEY, {})
}

export function addAffinity(characterId: string, amount: number) {
  const data = getAffinity()
  data[characterId] = (data[characterId] ?? 0) + amount
  writeJson(AFFINITY_KEY, data)
  return data[characterId]
}

export function getCharacterAffinity(characterId: string): number {
  return getAffinity()[characterId] ?? 0
}
