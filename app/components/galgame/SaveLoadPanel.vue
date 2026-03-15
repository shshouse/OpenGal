<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center" @click="emit('update:open', false)">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div
          class="relative max-h-[80vh] w-full max-w-lg rounded-xl border border-white/[0.08] bg-zinc-900/95 p-6 text-white backdrop-blur-xl"
          @click.stop
        >
          <h3 class="tracking-widest text-white/90" style="font-family: 'Noto Serif SC', serif">
            {{ mode === 'save' ? 'Save' : 'Load' }}
          </h3>
          <div class="mt-3 h-px bg-white/[0.06]" />

          <div class="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-2">

            <button
              v-if="mode === 'save'"
              class="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-transparent py-6 text-sm text-white/40 transition-all hover:border-pink-400/30 hover:bg-white/[0.03] hover:text-white/70"
              @click="emit('save'); emit('update:open', false)"
            >
              + 创建新存档
            </button>

            <p v-if="saves.length === 0" class="py-8 text-center text-sm text-white/25">暂无存档</p>

            <div
              v-for="s in saves"
              :key="s.id"
              class="group flex items-center gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] p-3.5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.04]"
            >
              <div
                class="h-9 w-9 shrink-0 rounded-full shadow-lg"
                :style="{
                  backgroundColor: getCharColor(s.characterId),
                  boxShadow: `0 0 12px ${getCharColor(s.characterId)}30`,
                }"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-white/80">{{ s.label }}</p>
                <p class="text-[10px] text-white/30">
                  {{ getCharName(s.characterId) }} | {{ formatTime(s.timestamp) }}
                </p>
              </div>
              <button
                v-if="mode === 'load'"
                class="shrink-0 rounded-md border border-pink-400/20 bg-pink-500/10 px-3 py-1.5 text-xs text-pink-300 transition-all hover:border-pink-400/40 hover:bg-pink-500/20 hover:text-pink-200"
                @click="emit('load', s); emit('update:open', false)"
              >
                Load
              </button>
              <button
                v-else
                class="shrink-0 rounded-md p-1.5 text-white/20 transition-colors hover:text-red-400"
                @click="handleDelete(s.id)"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { getSaves, deleteSave, type SaveData } from '~/utils/save-manager'
import { getCharacterProfile } from '~/data/characters'

const props = defineProps<{
  open: boolean
  mode: 'save' | 'load'
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: []
  load: [data: SaveData]
}>()

const saves = ref<SaveData[]>([])

watch(() => props.open, (val) => {
  if (val) saves.value = getSaves().sort((a, b) => b.timestamp - a.timestamp)
})

function getCharColor(id: string) {
  return getCharacterProfile(id)?.color ?? '#888'
}

function getCharName(id: string) {
  return getCharacterProfile(id)?.name ?? '?'
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function handleDelete(id: number) {
  deleteSave(id)
  saves.value = saves.value.filter((s) => s.id !== id)
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
