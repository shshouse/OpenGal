import { create } from 'zustand'
import { startMicCapture, stopMicCapture } from './micCapture'

interface ASRState {
  running: boolean
  partial: string
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  clearPartial: () => void
}

export const useASRStore = create<ASRState>((set, get) => ({
  running: false,
  partial: '',
  error: null,
  start: async () => {
    if (get().running) return
    set({ error: null })
    const res = await window.opengal.asr.start()
    if (!res.success) {
      set({ error: res.error || 'ASR start failed' })
      return
    }
    const config = await window.opengal.config.get()
    const sampleRate = config.data?.asr?.sampleRate ?? 16000
    try {
      await startMicCapture(sampleRate)
    } catch (e) {
      await window.opengal.asr.stop()
      set({ error: (e as Error).message })
      return
    }
    set({ running: true })
  },
  stop: async () => {
    if (!get().running) return
    stopMicCapture()
    await window.opengal.asr.stop()
    set({ running: false, partial: '' })
  },
  clearPartial: () => set({ partial: '' })
}))

let unsubPartial: (() => void) | null = null
let unsubFinal: (() => void) | null = null
let onFinalCallback: ((text: string) => void) | null = null

export function setASRFinalCallback(cb: ((text: string) => void) | null): void {
  onFinalCallback = cb
}

export function startASRBridge(): () => void {
  unsubPartial = window.opengal.asr.onPartial((text) => {
    useASRStore.setState({ partial: text })
  })
  unsubFinal = window.opengal.asr.onFinal((text) => {
    useASRStore.setState({ partial: '' })
    onFinalCallback?.(text)
  })
  return () => {
    unsubPartial?.()
    unsubFinal?.()
    unsubPartial = null
    unsubFinal = null
  }
}
