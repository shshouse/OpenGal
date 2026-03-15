<template>
  <div class="absolute inset-x-0 bottom-0 z-30">
    <div class="flex items-center justify-center gap-0.5 border-t border-white/[0.06] bg-zinc-950/85 px-4 py-1 backdrop-blur-md">
      <button
        v-for="ctrl in controls"
        :key="ctrl.label"
        :class="[
          'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-medium tracking-[0.12em] transition-all duration-200',
          ctrl.active
            ? 'bg-pink-500/15 text-pink-300 hover:bg-pink-500/25 hover:text-pink-200'
            : 'text-white/35 hover:bg-white/[0.06] hover:text-white/70'
        ]"
        :title="ctrl.tip"
        @click.stop="ctrl.onClick"
      >
        <Icon :name="ctrl.icon" class="h-3 w-3" />
        <span class="hidden sm:inline">{{ ctrl.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">

const props = defineProps<{
  isAutoPlay: boolean
  isSkipping: boolean
}>()

const emit = defineEmits<{
  toggleAuto: []
  toggleSkip: []
  showHistory: []
  showSettings: []
  save: []
  load: []
  quickSave: []
  quickLoad: []
}>()

const controls = computed(() => [
  { label: 'SAVE', icon: 'lucide:save', onClick: () => emit('save'), tip: '存档' },
  { label: 'LOAD', icon: 'lucide:folder-open', onClick: () => emit('load'), tip: '读档' },
  { label: 'Q.SAVE', icon: 'lucide:zap', onClick: () => emit('quickSave'), tip: '快速存档' },
  { label: 'Q.LOAD', icon: 'lucide:download', onClick: () => emit('quickLoad'), tip: '快速读档' },
  { label: 'AUTO', icon: 'lucide:play', onClick: () => emit('toggleAuto'), active: props.isAutoPlay, tip: '自动播放' },
  { label: 'SKIP', icon: 'lucide:fast-forward', onClick: () => emit('toggleSkip'), active: props.isSkipping, tip: '跳过' },
  { label: 'LOG', icon: 'lucide:scroll-text', onClick: () => emit('showHistory'), tip: '历史记录' },
  { label: 'CONFIG', icon: 'lucide:settings', onClick: () => emit('showSettings'), tip: '设置' },
])
</script>
