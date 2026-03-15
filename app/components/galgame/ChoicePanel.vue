<template>
  <div class="absolute inset-0 z-30 flex items-center justify-center">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-[3px]" />
    <div class="relative flex w-full max-w-lg flex-col gap-3 px-6">
      <button
        v-for="(choice, i) in choices"
        :key="i"
        class="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900/60 px-8 py-4 text-left backdrop-blur-xl transition-all duration-300 hover:border-pink-400/30 hover:bg-zinc-800/70 hover:shadow-lg hover:shadow-pink-500/5"
        @click.stop="emit('choice', choice)"
      >
        <div class="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-transparent via-pink-400/0 to-transparent transition-all duration-300 group-hover:via-pink-400/60" />
        <div class="absolute inset-0 bg-gradient-to-r from-pink-500/0 to-transparent transition-all duration-300 group-hover:from-pink-500/[0.06]" />
        <span
          class="relative text-[15px] tracking-wider text-white/75 transition-colors duration-300 group-hover:text-white/95"
          style="font-family: 'Noto Serif SC', serif"
        >
          {{ choice.text }}
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Choice } from '~/types/galgame'

defineProps<{ choices: Choice[] }>()
const emit = defineEmits<{ choice: [choice: Choice] }>()
</script>
