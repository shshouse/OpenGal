<template>
  <div class="relative flex h-screen w-screen overflow-hidden">

    <div class="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-violet-950" />
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-pink-900/20 via-transparent to-transparent" />
    <div
      class="absolute inset-0 opacity-[0.03]"
      :style="{
        backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }"
    />

    <div class="relative z-10 flex h-full w-full flex-col items-center justify-center px-6 py-10">
      <h2
        class="mb-2 text-3xl font-bold tracking-wider text-white/90"
        style="font-family: 'Noto Serif SC', serif"
      >
        选择你的搭档
      </h2>
      <p class="mb-8 text-sm tracking-widest text-white/30">CHOOSE YOUR PARTNER</p>


      <div class="flex flex-wrap justify-center gap-4 px-4">
        <div
          v-for="char in characterProfiles"
          :key="char.id"
          :class="[
            'group relative h-[280px] w-[180px] cursor-pointer overflow-hidden rounded-xl border transition-all duration-300',
            selectedId === char.id
              ? 'scale-105 border-pink-400/50 shadow-[0_0_30px_rgba(236,72,153,0.25)]'
              : hoveredId === char.id
                ? 'scale-[1.02] border-white/20'
                : 'border-white/[0.06]'
          ]"
          :style="{
            background: selectedId === char.id
              ? `linear-gradient(180deg, ${char.color}12, ${char.color}05)`
              : 'rgba(255,255,255,0.02)',
          }"
          @mouseenter="hoveredId = char.id"
          @mouseleave="hoveredId = null"
          @click="selectedId = char.id"
        >

          <div class="relative h-[calc(100%-52px)] overflow-hidden">
            <img
              :src="encodeURI(char.previewSprite)"
              :alt="char.name"
              class="absolute left-1/2 top-[-5%] h-[180%] -translate-x-1/2 object-contain transition-transform duration-300 group-hover:scale-105"
              :style="{
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 85%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 85%, transparent 100%)',
              }"
            />
            <div
              v-if="selectedId === char.id"
              class="absolute inset-0 opacity-20"
              :style="{ background: `radial-gradient(ellipse at center bottom, ${char.color}, transparent 70%)` }"
            />
          </div>


          <div class="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/50 px-3 py-3 backdrop-blur-md">
            <p
              class="text-sm font-bold tracking-wider text-white/90"
              style="font-family: 'Noto Serif SC', serif"
            >
              {{ char.name }}
            </p>
            <span
              v-if="getCharacterAffinity(char.id) > 0"
              class="flex items-center gap-1 rounded bg-pink-500/15 px-1.5 py-0.5 text-pink-300"
            >
              <Icon name="mdi:heart" class="h-2.5 w-2.5" />
              <span class="text-[10px]">{{ getCharacterAffinity(char.id) }}</span>
            </span>
          </div>
        </div>
      </div>


      <Transition name="fade">
        <div v-if="selected" class="mt-8 flex flex-col items-center gap-4">
          <div class="flex items-center gap-3">
            <div
              class="h-3 w-3 rounded-full shadow-lg"
              :style="{ backgroundColor: selected.color, boxShadow: `0 0 12px ${selected.color}60` }"
            />
            <p
              class="text-lg font-bold tracking-wider text-white/80"
              style="font-family: 'Noto Serif SC', serif"
            >
              {{ selected.name }}
            </p>
          </div>
          <p class="max-w-md text-center text-sm leading-relaxed text-white/40">
            {{ selected.description }}
          </p>
          <button
            class="mt-2 rounded-lg border border-pink-400/30 bg-pink-500/10 px-8 py-3 text-sm font-medium tracking-widest text-pink-300 transition-all duration-200 hover:border-pink-400/50 hover:bg-pink-500/20 hover:text-pink-200"
            @click="emit('select', selected!)"
          >
            START
          </button>
          <p v-if="error" class="mt-2 max-w-md text-center text-sm text-red-400">{{ error }}</p>
        </div>
      </Transition>


      <button
        class="mt-6 flex items-center gap-1.5 text-xs tracking-widest text-white/30 transition-colors hover:text-white/60"
        @click="emit('back')"
      >
        <Icon name="lucide:chevron-left" class="h-3.5 w-3.5" />
        BACK
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { characterProfiles, type CharacterProfile } from '~/data/characters'
import { getCharacterAffinity } from '~/utils/save-manager'

defineProps<{
  error?: string | null
}>()

const emit = defineEmits<{
  select: [char: CharacterProfile]
  back: []
}>()

const hoveredId = ref<string | null>(null)
const selectedId = ref<string | null>(null)

const selected = computed(() =>
  selectedId.value ? characterProfiles.find((c) => c.id === selectedId.value) ?? null : null
)
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
