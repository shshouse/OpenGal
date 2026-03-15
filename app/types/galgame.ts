export interface Character {
  id: string
  name: string
  nameColor: string
  sprites: Record<string, string>
}

export interface DialogueLine {
  characterId: string | null
  expression?: string
  text: string
  choices?: Choice[]
}

export interface Choice {
  text: string
  nextSceneId: string
}

export interface SceneCharacter {
  characterId: string
  expression: string
  position: 'left' | 'center' | 'right'
}

export interface Scene {
  id: string
  background: string
  characters: SceneCharacter[]
  dialogues: DialogueLine[]
  nextSceneId?: string
}

export interface GalgameScript {
  title: string
  subtitle?: string
  characters: Character[]
  scenes: Scene[]
  startSceneId: string
}

export interface HistoryEntry {
  characterName: string | null
  text: string
}
