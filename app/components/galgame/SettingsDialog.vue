<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center" @click="emit('update:open', false)">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div
          class="relative w-full max-w-md rounded-xl border border-white/[0.08] bg-zinc-900/95 p-6 text-white backdrop-blur-xl"
          @click.stop
        >
          <h3 class="tracking-widest text-white/90" style="font-family: 'Noto Serif SC', serif">Settings</h3>
          <div class="mt-3 h-px bg-white/[0.06]" />

          <div class="mt-5 space-y-6">

            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <label class="text-sm text-white/80">Text Speed</label>
                <span class="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-white/50">{{ textSpeed }}ms</span>
              </div>
              <input
                type="range"
                :value="textSpeed"
                min="10"
                max="100"
                step="5"
                class="w-full accent-pink-500"
                @input="emit('update:textSpeed', Number(($event.target as HTMLInputElement).value))"
              />
              <p class="text-xs text-white/30">Lower = faster</p>
            </div>

            <div class="h-px bg-white/[0.06]" />


            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm text-white/80">Auto Play</label>
                <p class="text-xs text-white/30">Auto advance dialogue</p>
              </div>
              <button
                :class="[
                  'relative h-6 w-11 rounded-full transition-colors duration-200',
                  isAutoPlay ? 'bg-pink-500' : 'bg-white/20'
                ]"
                @click="emit('update:isAutoPlay', !isAutoPlay)"
              >
                <span
                  :class="[
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
                    isAutoPlay ? 'left-[22px]' : 'left-0.5'
                  ]"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  open: boolean
  textSpeed: number
  isAutoPlay: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:textSpeed': [value: number]
  'update:isAutoPlay': [value: boolean]
}>()
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
