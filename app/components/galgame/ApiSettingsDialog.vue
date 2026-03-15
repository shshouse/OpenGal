<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center" @click="emit('update:open', false)">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div
          class="relative w-full max-w-md rounded-xl border border-white/[0.08] bg-zinc-900/95 p-6 text-white backdrop-blur-xl"
          @click.stop
        >
          <h3 class="tracking-widest text-white/90" style="font-family: 'Noto Serif SC', serif">API Settings</h3>
          <div class="mt-3 h-px bg-white/[0.06]" />

          <div class="mt-4 space-y-5">
            <div class="space-y-2">
              <label class="text-sm text-white/70">API Base URL</label>
              <input
                v-model="settings.apiUrl"
                type="url"
                placeholder="https://api.openai.com/v1"
                class="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-white/90 placeholder:text-white/20 focus:border-pink-400/30 focus:outline-none focus:ring-1 focus:ring-pink-400/20"
              />
              <p class="text-[11px] text-white/25">支持 OpenAI 兼容 API（Deepseek、Moonshot 等）</p>
            </div>

            <div class="space-y-2">
              <label class="text-sm text-white/70">API Key</label>
              <div class="relative">
                <input
                  v-model="settings.apiKey"
                  :type="showKey ? 'text' : 'password'"
                  placeholder="sk-..."
                  class="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 pr-10 text-sm text-white/90 placeholder:text-white/20 focus:border-pink-400/30 focus:outline-none focus:ring-1 focus:ring-pink-400/20"
                />
                <button
                  type="button"
                  class="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                  @click="showKey = !showKey"
                >
                  <Icon :name="showKey ? 'lucide:eye-off' : 'lucide:eye'" class="h-4 w-4" />
                </button>
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-sm text-white/70">Model</label>
              <input
                v-model="settings.model"
                type="text"
                placeholder="gpt-4o-mini"
                class="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-white/90 placeholder:text-white/20 focus:border-pink-400/30 focus:outline-none focus:ring-1 focus:ring-pink-400/20"
              />
            </div>

            <div class="h-px bg-white/[0.06]" />

            <button
              class="flex w-full items-center justify-center gap-2 rounded-lg bg-pink-500/15 py-2.5 text-sm text-pink-300 transition-colors hover:bg-pink-500/25 hover:text-pink-200 disabled:opacity-50"
              :disabled="saved"
              @click="handleSave"
            >
              <Icon v-if="saved" name="lucide:check" class="h-4 w-4" />
              {{ saved ? '已保存' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { getApiSettings, saveApiSettings, type ApiSettings } from '~/utils/api-settings'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const settings = ref<ApiSettings>({ apiUrl: '', apiKey: '', model: '' })
const showKey = ref(false)
const saved = ref(false)

watch(() => props.open, (val) => {
  if (val) {
    settings.value = { ...getApiSettings() }
    saved.value = false
  }
})

function handleSave() {
  saveApiSettings(settings.value)
  saved.value = true
  setTimeout(() => emit('update:open', false), 600)
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
