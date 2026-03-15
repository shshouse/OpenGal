<template>
  <Teleport to="body">
    <Transition name="slide">
      <div v-if="open" class="fixed inset-0 z-50 flex" @click="emit('update:open', false)">
        <div
          class="h-full w-80 border-r border-white/[0.06] bg-zinc-950/95 text-white backdrop-blur-2xl md:w-96"
          @click.stop
        >
          <div class="px-6 pt-6">
            <h3 class="tracking-widest text-white/80" style="font-family: 'Noto Serif SC', serif">
              History
            </h3>
            <div class="mt-3 h-px bg-gradient-to-r from-pink-400/20 via-white/10 to-transparent" />
          </div>
          <div class="mt-4 h-[calc(100vh-6rem)] overflow-y-auto px-6 pr-4">
            <p v-if="history.length === 0" class="py-8 text-center text-sm text-white/25">No history yet.</p>
            <div v-for="(entry, i) in history" :key="i" class="py-3">
              <span
                v-if="entry.characterName"
                class="mb-1 block text-xs font-bold tracking-widest text-pink-400/70"
                style="font-family: 'Noto Serif SC', serif"
              >
                {{ entry.characterName }}
              </span>
              <p class="text-sm leading-relaxed text-white/45">{{ entry.text }}</p>
              <div v-if="i < history.length - 1" class="mt-3 h-px bg-white/[0.04]" />
            </div>
          </div>
        </div>
        <div class="flex-1 bg-black/40" />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { HistoryEntry } from '~/types/galgame'

defineProps<{
  history: HistoryEntry[]
  open: boolean
}>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateX(-100%);
}
</style>
