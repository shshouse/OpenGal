<template>
  <div class="relative flex h-screen w-screen overflow-hidden">
    <div class="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-pink-950" />
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-pink-900/15 via-transparent to-transparent" />

    <div class="relative z-10 flex h-full w-full flex-col items-center justify-center gap-6 px-6">
      <Icon name="lucide:loader-2" class="h-12 w-12 animate-spin text-pink-400/50" />

      <div class="text-center">
        <h2
          class="mb-2 text-2xl font-bold tracking-wider text-white/80"
          style="font-family: 'Noto Serif SC', serif"
        >
          正在生成剧本...
        </h2>
        <p class="text-sm text-white/30">
          {{ characterName }} 正在认真阅读你的文档
        </p>
      </div>

      <div class="mt-4 flex items-center gap-2 rounded-lg bg-white/[0.04] px-4 py-2">
        <Icon name="lucide:file-text" class="h-4 w-4 text-white/30" />
        <span class="text-xs text-white/40">{{ fileName }}</span>
      </div>

      <p class="mt-2 text-xs text-white/20">这可能需要 10-30 秒</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  fileName: string
  characterName: string
}>()
</script>
