<template>
  <div class="relative mx-4 overflow-hidden rounded-t-2xl border border-b-0 border-white/[0.08] bg-zinc-950/75 backdrop-blur-xl md:mx-8">
    <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-pink-400/40 to-transparent" />
    <div class="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent" />
    <div class="relative px-8 py-5 md:px-12 md:py-6">
      <div class="min-h-[4rem]" style="font-family: 'Noto Serif SC', serif">
        <p
          v-if="characterName"
          class="mb-2 text-[15px] font-bold tracking-wider"
          :style="{ color: nameColor || '#f9a8d4' }"
        >
          {{ characterName }}
        </p>
        <p class="text-[15px] leading-[2] tracking-wider text-white/85 md:text-base">
          {{ characterName ? `「${text}」` : text }}
          <span v-if="!isComplete" class="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-pink-300/80" />
        </p>
      </div>
      <div v-if="isComplete" class="absolute bottom-3 right-8 animate-bounce text-pink-300/40">
        <Icon name="lucide:chevron-down" class="h-3 w-3" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  characterName: string | null
  nameColor: string
  text: string
  isComplete: boolean
}>()
</script>
