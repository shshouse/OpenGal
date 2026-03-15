import { ref, computed } from 'vue'
import type { GalgameScript, Choice, HistoryEntry } from '~/types/galgame'
import {
  writeSave,
  writeQuickSave,
  getQuickSave,
  addAffinity,
  getAffinity,
  type SaveData,
} from '~/utils/save-manager'

export function useGalgameEngine(script: Ref<GalgameScript>) {
  const currentSceneId = ref(script.value.startSceneId)
  const dialogueIndex = ref(0)
  const history = ref<HistoryEntry[]>([])
  const isAutoPlay = ref(false)
  const isSkipping = ref(false)
  const textSpeed = ref(40)
  const showTitle = ref(true)
  const isEnded = ref(false)
  const activeCharacterId = ref('murasame')

  const currentScene = computed(() =>
    script.value.scenes.find((s) => s.id === currentSceneId.value) ?? null
  )

  const currentDialogue = computed(() =>
    currentScene.value?.dialogues[dialogueIndex.value] ?? null
  )

  const hasChoices = computed(() =>
    !!(currentDialogue.value?.choices && currentDialogue.value.choices.length > 0)
  )

  function getCharacterName(characterId: string | null) {
    if (!characterId) return null
    return script.value.characters.find((c) => c.id === characterId)?.name ?? null
  }

  function getCharacter(characterId: string) {
    return script.value.characters.find((c) => c.id === characterId) ?? null
  }

  function getCharacterColor(characterId: string | null) {
    if (!characterId) return '#9ca3af'
    return script.value.characters.find((c) => c.id === characterId)?.nameColor ?? '#9ca3af'
  }

  function stopSkip() {
    isSkipping.value = false
  }

  function advance() {
    if (!currentScene.value || !currentDialogue.value || hasChoices.value) return

    history.value.push({
      characterName: getCharacterName(currentDialogue.value.characterId),
      text: currentDialogue.value.text,
    })

    if (dialogueIndex.value < currentScene.value.dialogues.length - 1) {
      dialogueIndex.value++
    } else if (currentScene.value.nextSceneId) {
      currentSceneId.value = currentScene.value.nextSceneId
      dialogueIndex.value = 0
    } else {
      isEnded.value = true
      stopSkip()
    }
  }

  function makeChoice(choice: Choice) {
    if (currentDialogue.value) {
      history.value.push(
        {
          characterName: getCharacterName(currentDialogue.value.characterId),
          text: currentDialogue.value.text,
        },
        {
          characterName: null,
          text: `> ${choice.text}`,
        }
      )
    }
    addAffinity(activeCharacterId.value, 1)
    currentSceneId.value = choice.nextSceneId
    dialogueIndex.value = 0
    stopSkip()
  }

  function startGame(characterId?: string) {
    if (characterId) activeCharacterId.value = characterId
    showTitle.value = false
    currentSceneId.value = script.value.startSceneId
    dialogueIndex.value = 0
    history.value = []
    isEnded.value = false
  }

  function restartGame() {
    showTitle.value = true
    isEnded.value = false
    stopSkip()
  }

  function toggleSkip() {
    isSkipping.value = !isSkipping.value
  }

  function save(label?: string) {
    return writeSave({
      sceneId: currentSceneId.value,
      dialogueIndex: dialogueIndex.value,
      characterId: activeCharacterId.value,
      label: label ?? `Scene: ${currentSceneId.value} #${dialogueIndex.value}`,
      affinity: getAffinity(),
    })
  }

  function quickSave() {
    writeQuickSave({
      sceneId: currentSceneId.value,
      dialogueIndex: dialogueIndex.value,
      characterId: activeCharacterId.value,
      label: 'Quick Save',
      affinity: getAffinity(),
    })
  }

  function loadSave(data: SaveData) {
    currentSceneId.value = data.sceneId
    dialogueIndex.value = data.dialogueIndex
    activeCharacterId.value = data.characterId
    showTitle.value = false
    isEnded.value = false
    stopSkip()
  }

  function quickLoad() {
    const data = getQuickSave()
    if (data) loadSave(data)
  }

  return {
    currentScene,
    currentDialogue,
    hasChoices,
    history,
    isAutoPlay,
    isSkipping,
    textSpeed,
    showTitle,
    isEnded,
    activeCharacterId,
    advance,
    makeChoice,
    startGame,
    restartGame,
    toggleSkip,
    stopSkip,
    save,
    quickSave,
    loadSave,
    quickLoad,
    getCharacter,
    getCharacterName,
    getCharacterColor,
  }
}
