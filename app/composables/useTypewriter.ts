import { ref, watch, onUnmounted } from 'vue'

export function useTypewriter(text: Ref<string>, speed: Ref<number>) {
  const displayedText = ref('')
  const isComplete = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function complete() {
    stopTimer()
    displayedText.value = text.value
    isComplete.value = true
  }

  if (import.meta.client) {
    watch(
      [text, speed],
      () => {
        stopTimer()
        displayedText.value = ''
        isComplete.value = false

        if (!text.value) {
          isComplete.value = true
          return
        }

        if (speed.value <= 0) {
          displayedText.value = text.value
          isComplete.value = true
          return
        }

        let index = 0
        timer = setInterval(() => {
          index++
          displayedText.value = text.value.slice(0, index)
          if (index >= text.value.length) {
            isComplete.value = true
            stopTimer()
          }
        }, speed.value)
      },
      { immediate: true }
    )

    onUnmounted(stopTimer)
  }

  return { displayedText, isComplete, complete }
}
