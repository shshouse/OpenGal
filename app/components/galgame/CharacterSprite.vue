<template>
  <div :class="['absolute bottom-0 z-10 transition-all duration-500', positionClass]">
    <img
      :src="encodeURI(spriteUrl)"
      :alt="character.name"
      class="h-[85vh] w-auto object-contain drop-shadow-[0_0_20px_rgba(0,0,0,0.3)]"
      :style="{
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 3%, black 88%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 3%, black 88%, transparent 100%)',
      }"
    />
  </div>
</template>

<script setup lang="ts">
import type { Character } from '~/types/galgame'

const props = defineProps<{
  character: Character
  expression: string
  position: 'left' | 'center' | 'right'
}>()

const positionClasses: Record<string, string> = {
  left: 'left-[5%]',
  center: 'left-1/2 -translate-x-1/2',
  right: 'right-[5%]',
}

const positionClass = computed(() => positionClasses[props.position])
const spriteUrl = computed(() => props.character.sprites[props.expression] ?? props.character.sprites['normal'])
</script>
