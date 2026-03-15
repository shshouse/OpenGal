<template>
  <div class="absolute inset-0 transition-all duration-1000">
    <div v-if="isGradient" :class="`h-full w-full bg-gradient-to-br ${gradientClass}`" />
    <template v-else>
      <img
        v-if="!imgError"
        :src="encodeURI(src)"
        alt=""
        class="h-full w-full object-cover"
        @error="imgError = true"
      />
      <div v-else class="h-full w-full bg-gradient-to-br from-indigo-950 via-purple-900 to-pink-900" />
    </template>
    <div class="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ src: string }>()
const imgError = ref(false)
const isGradient = computed(() => props.src.startsWith('gradient:'))
const gradientClass = computed(() => props.src.replace('gradient:', ''))

watch(() => props.src, () => { imgError.value = false })
</script>
