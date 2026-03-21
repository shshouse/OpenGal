<template>
  <div>

    <GalgameTitleScreen
      v-if="phase === 'title'"
      @start="phase = 'upload'"
      @open-api-settings="showApiSettings = true"
    />


    <GalgameUploadPanel
      v-else-if="phase === 'upload'"
      @text-extracted="onTextExtracted"
      @use-demo="onUseDemo"
      @back="phase = 'title'"
    />


    <GalgameCharacterSelect
      v-else-if="phase === 'select'"
      :error="generateError"
      @select="onCharacterSelect"
      @back="phase = 'upload'"
    />


    <GalgameGeneratingScreen
      v-else-if="phase === 'generating'"
      :file-name="uploadedFileName"
      :character-name="selectedChar.name"
    />


    <div
      v-else
      class="relative h-screen w-screen cursor-pointer select-none overflow-hidden bg-black"
      @click="handleClick"
    >
      <GalgameSceneBackground
        v-if="engine.currentScene.value"
        :src="engine.currentScene.value.background"
      />

      <GalgameCharacterSprite
        v-for="char in engine.currentScene.value?.characters"
        :key="char.characterId"
        :character="engine.getCharacter(char.characterId)!"
        :expression="
          engine.currentDialogue.value?.characterId === char.characterId
            ? (engine.currentDialogue.value?.expression ?? 'normal')
            : char.expression
        "
        :position="char.position"
      />

      <GalgameChoicePanel
        v-if="engine.hasChoices.value && engine.currentDialogue.value?.choices && isComplete"
        :choices="engine.currentDialogue.value.choices"
        @choice="onChoice"
      />

      <div v-if="engine.currentDialogue.value && !engine.isEnded.value" class="absolute inset-x-0 bottom-[30px] z-20">
        <GalgameDialogueBox
          :character-name="engine.getCharacterName(engine.currentDialogue.value.characterId)"
          :name-color="engine.getCharacterColor(engine.currentDialogue.value.characterId)"
          :text="displayedText"
          :is-complete="isComplete && !engine.hasChoices.value"
        />
      </div>

      <GalgameControlBar
        :is-auto-play="engine.isAutoPlay.value"
        :is-skipping="engine.isSkipping.value"
        @toggle-auto="engine.isAutoPlay.value = !engine.isAutoPlay.value"
        @toggle-skip="engine.toggleSkip()"
        @show-history="showHistory = true"
        @show-settings="showSettings = true"
        @save="saveMode = 'save'"
        @load="saveMode = 'load'"
        @quick-save="engine.quickSave()"
        @quick-load="engine.quickLoad()"
      />

      <GalgameHistoryPanel
        :history="engine.history.value"
        :open="showHistory"
        @update:open="showHistory = $event"
      />

      <GalgameSettingsDialog
        :open="showSettings"
        :text-speed="engine.textSpeed.value"
        :is-auto-play="engine.isAutoPlay.value"
        @update:open="showSettings = $event"
        @update:text-speed="engine.textSpeed.value = $event"
        @update:is-auto-play="engine.isAutoPlay.value = $event"
      />

      <GalgameSaveLoadPanel
        :open="saveMode !== null"
        :mode="saveMode ?? 'save'"
        @update:open="(v: boolean) => { if (!v) saveMode = null }"
        @save="engine.save()"
        @load="engine.loadSave($event)"
      />


      <div v-if="engine.isEnded.value" class="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div class="flex flex-col items-center gap-8 text-center">
          <p
            class="text-2xl tracking-[0.5em] text-white/60"
            style="font-family: 'Noto Serif SC', serif"
          >
            Fin
          </p>
          <button
            class="rounded-lg border border-white/10 bg-white/5 px-8 py-3 text-sm tracking-widest text-white/50 transition-all hover:border-pink-400/30 hover:bg-white/10 hover:text-white/80"
            @click.stop="resetToTitle"
          >
            TITLE
          </button>
        </div>
      </div>
    </div>


    <GalgameApiSettingsDialog
      :open="showApiSettings"
      @update:open="showApiSettings = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { characterProfiles, type CharacterProfile } from '~/data/characters'
import { buildDemoScript } from '~/data/demo-script'
import { useGalgameEngine } from '~/composables/useGalgameEngine'
import { useTypewriter } from '~/composables/useTypewriter'
import { getApiSettings } from '~/utils/api-settings'
import { generateScriptFromLLM } from '~/utils/generate-script'
import { buildSystemPrompt, buildUserPrompt } from '~/utils/prompt'
import { addAffinity } from '~/utils/save-manager'
import type { GalgameScript, Choice } from '~/types/galgame'

useHead({ title: 'OpenGal - AI Paper Reader' })

type Phase = 'title' | 'upload' | 'select' | 'generating' | 'playing'

const phase = ref<Phase>('title')
const selectedChar = ref<CharacterProfile>(characterProfiles[0])
const uploadedText = ref<string | null>(null)
const uploadedFileName = ref('')
const generatedScript = ref<GalgameScript | null>(null)
const generateError = ref<string | null>(null)
const showApiSettings = ref(false)
const showHistory = ref(false)
const showSettings = ref(false)
const saveMode = ref<'save' | 'load' | null>(null)

const script = computed<GalgameScript>(() => {
  if (generatedScript.value) return generatedScript.value
  return buildDemoScript(selectedChar.value)
})

const engine = useGalgameEngine(script)

const typewriterText = computed(() => engine.currentDialogue.value?.text ?? '')
const typewriterSpeed = computed(() => engine.isSkipping.value ? 0 : engine.textSpeed.value)
const { displayedText, isComplete, complete } = useTypewriter(typewriterText, typewriterSpeed)

function handleClick() {
  if (engine.isEnded.value) return
  if (!isComplete.value) {
    complete()
  } else if (!engine.hasChoices.value) {
    engine.advance()
  }
}

function onChoice(choice: Choice) {
  addAffinity(selectedChar.value.id, 1)
  engine.makeChoice(choice)
}

function onTextExtracted(text: string, fileName: string) {
  uploadedText.value = text
  uploadedFileName.value = fileName
  generatedScript.value = null
  phase.value = 'select'
}

function onUseDemo() {
  uploadedText.value = null
  generatedScript.value = null
  phase.value = 'select'
}

async function onCharacterSelect(char: CharacterProfile) {
  selectedChar.value = char
  if (uploadedText.value) {
    await generateScript(char)
  } else {
    phase.value = 'playing'
    nextTick(() => engine.startGame(char.id))
  }
}

async function generateScript(char: CharacterProfile) {
  phase.value = 'generating'
  generateError.value = null

  try {
    const apiSettings = getApiSettings()
    const systemPrompt = buildSystemPrompt(char)
    const userPrompt = buildUserPrompt(uploadedText.value!)

    const llmScript = await generateScriptFromLLM(apiSettings, systemPrompt, userPrompt)
    const fullScript: GalgameScript = {
      title: llmScript.title ?? uploadedFileName.value,
      subtitle: 'AI Paper Reader',
      characters: [{
        id: char.id,
        name: char.name,
        nameColor: char.nameColor,
        sprites: char.sprites,
      }],
      startSceneId: llmScript.scenes?.[0]?.id ?? 'scene_intro',
      scenes: (llmScript.scenes ?? []).map((scene: any) => ({
        ...scene,
        background: scene.background ?? 'gradient:from-indigo-900/80 via-slate-900 to-pink-950/60',
        characters: [{ characterId: char.id, expression: 'normal', position: 'center' as const }],
      })),
    }

    generatedScript.value = fullScript
    phase.value = 'playing'
    nextTick(() => engine.startGame(char.id))
  } catch (err: any) {
    generateError.value = err.message || '未知错误'
    phase.value = 'select'
  }
}

function resetToTitle() {
  phase.value = 'title'
  generatedScript.value = null
  uploadedText.value = null
  engine.restartGame()
}


watch([() => engine.isAutoPlay.value, isComplete], () => {
  if (!engine.isAutoPlay.value || !isComplete.value || engine.hasChoices.value || engine.isEnded.value) return
  setTimeout(() => engine.advance(), 2000)
})


let skipTimer: ReturnType<typeof setInterval> | null = null
watch(() => engine.isSkipping.value, (val) => {
  if (skipTimer) { clearInterval(skipTimer); skipTimer = null }
  if (val && !engine.hasChoices.value && !engine.isEnded.value) {
    skipTimer = setInterval(() => engine.advance(), 80)
  }
})
watch(() => engine.hasChoices.value, (val) => {
  if (val && engine.isSkipping.value) engine.stopSkip()
})
onUnmounted(() => { if (skipTimer) clearInterval(skipTimer) })


function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    handleClick()
  }
}
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>
