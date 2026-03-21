<template>
  <div class="relative flex h-screen w-screen overflow-hidden">
    <div class="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950" />
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-violet-900/15 via-transparent to-transparent" />

    <div class="relative z-10 flex h-full w-full flex-col items-center justify-center px-6">
      <h2
        class="mb-2 text-3xl font-bold tracking-wider text-white/90"
        style="font-family: 'Noto Serif SC', serif"
      >
        上传文档
      </h2>
      <p class="mb-8 text-sm tracking-widest text-white/30">UPLOAD DOCUMENT</p>


      <div
        :class="[
          'w-full max-w-lg cursor-pointer rounded-xl border-2 border-dashed bg-transparent transition-all duration-300',
          isDragging
            ? 'border-pink-400/50 bg-pink-500/5 shadow-[0_0_30px_rgba(236,72,153,0.15)]'
            : 'border-white/[0.08] hover:border-white/20'
        ]"
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="onDrop"
        @click="inputRef?.click()"
      >
        <div class="flex flex-col items-center gap-4 py-12">
          <input
            ref="inputRef"
            type="file"
            :accept="ACCEPT"
            class="hidden"
            @change="onFileChange"
          />

          <template v-if="isUploading">
            <Icon name="lucide:loader-2" class="h-10 w-10 animate-spin text-pink-400/60" />
            <p class="text-sm text-white/50">正在解析 {{ fileName }}...</p>
          </template>

          <template v-else>
            <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04] text-white/30">
              <Icon name="lucide:upload" class="h-7 w-7" />
            </div>
            <div class="text-center">
              <p class="text-sm text-white/60">拖拽文件到此处或点击上传</p>
              <div class="mt-2 flex justify-center gap-1.5">
                <span class="rounded bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/40">PDF</span>
                <span class="rounded bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/40">Word</span>
                <span class="rounded bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/40">TXT</span>
              </div>
            </div>
          </template>

          <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
        </div>
      </div>


      <div class="my-6 flex w-full max-w-lg items-center gap-3">
        <div class="h-px flex-1 bg-white/[0.06]" />
        <span class="text-xs tracking-widest text-white/20">OR</span>
        <div class="h-px flex-1 bg-white/[0.06]" />
      </div>


      <button
        class="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white/50 transition-all hover:border-white/20 hover:bg-white/[0.06] hover:text-white/70"
        @click="emit('useDemo')"
      >
        <Icon name="lucide:book-open" class="h-4 w-4" />
        使用 Demo 剧本
      </button>


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
const ACCEPT = '.pdf,.doc,.docx,.txt'
const MAX_SIZE_MB = 20

const emit = defineEmits<{
  textExtracted: [text: string, fileName: string]
  useDemo: []
  back: []
}>()

const isDragging = ref(false)
const isUploading = ref(false)
const error = ref<string | null>(null)
const fileName = ref<string | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

async function handleFile(file: File) {
  error.value = null
  fileName.value = file.name

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    error.value = `File too large (max ${MAX_SIZE_MB}MB)`
    return
  }

  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!['pdf', 'doc', 'docx', 'txt'].includes(ext ?? '')) {
    error.value = 'Unsupported file type. Please upload PDF, Word, or TXT.'
    return
  }

  isUploading.value = true
  try {
    const data = await parseDocument(file)
    emit('textExtracted', data.text, data.fileName)
  } catch (err: any) {
    error.value = err.message || '解析失败'
  } finally {
    isUploading.value = false
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file) handleFile(file)
}

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) handleFile(file)
}
</script>
