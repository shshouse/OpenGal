import { create } from 'zustand'
import { startMicCapture, stopMicCapture } from './micCapture'
import { pipelineBus } from '@/features/pipeline/pipelineBus'
import type { ASRConfig } from '@shared/types'
import { needsASRRestart } from '@shared/asrSettings'
import { getErrorMessage } from '@shared/errors'

interface ASRState {
  running: boolean
  partial: string
  error: string | null
  applying: boolean
  settings: ASRConfig | null
  applySettings: (settings: ASRConfig) => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  clearPartial: () => void
}

let lifecycle = Promise.resolve()
let wanted = false
let settingsVersion = 0

function serialize(operation: () => Promise<void>): Promise<void> {
  const result = lifecycle.then(operation)
  lifecycle = result.catch(() => {})
  return result
}

async function stopCapture(): Promise<void> {
  stopMicCapture()
  useASRStore.setState({ running: false, partial: '' })
  const result = await window.opengal.asr.stop()
  if (!result.success) throw new Error(result.error || '停止识别失败')
}

async function startCapture(): Promise<void> {
  if (!wanted || useASRStore.getState().running) return
  const version = settingsVersion
  const config = await window.opengal.config.get()
  if (!config.success || !config.data) throw new Error(config.error || '读取语音配置失败')
  const settings = version === settingsVersion ? config.data.asr : useASRStore.getState().settings ?? config.data.asr
  useASRStore.setState({ settings, error: null })
  if (!wanted) return
  const result = await window.opengal.asr.start()
  if (!result.success) throw new Error(result.error || '启动识别失败')
  try {
    if (!wanted) { await stopCapture(); return }
    await startMicCapture(settings.sampleRate, settings.deviceId || undefined)
    if (!wanted) { await stopCapture(); return }
    useASRStore.setState({ running: true })
  } catch (error) {
    await stopCapture().catch(() => {})
    throw error
  }
}

export const useASRStore = create<ASRState>((set, get) => ({
  running: false,
  partial: '',
  error: null,
  applying: false,
  settings: null,
  start: async () => {
    wanted = true
    await serialize(async () => {
      set({ applying: true, error: null })
      try { await startCapture() } catch (error) {
        if (wanted) { wanted = false; set({ error: getErrorMessage(error) }) }
      }
      finally { set({ applying: false }) }
    })
  },
  stop: async () => {
    wanted = false
    stopMicCapture()
    set({ running: false, partial: '' })
    await serialize(async () => {
      try { await stopCapture() } catch (error) { set({ error: getErrorMessage(error) }) }
    })
  },
  applySettings: async (settings) => {
    settingsVersion++
    const restart = needsASRRestart(get().settings, settings)
    set({ settings })
    pipelineBus.emit('asr:settingsChanged', undefined)
    if (!restart || !wanted) return
    await serialize(async () => {
      if (!wanted) return
      set({ applying: true, error: null })
      try { await stopCapture(); await startCapture() }
      catch (error) { set({ error: getErrorMessage(error) }); throw error }
      finally { set({ applying: false }) }
    })
  },
  clearPartial: () => set({ partial: '' })
}))

let unsubPartial: (() => void) | null = null
let unsubFinal: (() => void) | null = null
let unsubSpeechStart: (() => void) | null = null
let onFinalCallback: ((text: string) => void) | null = null

export function setASRFinalCallback(cb: ((text: string) => void) | null): void {
  onFinalCallback = cb
}

export function startASRBridge(): () => void {
  unsubSpeechStart = window.opengal.asr.onSpeechStart(() => {
    if (useASRStore.getState().running) pipelineBus.emit('user:speechStart', undefined)
  })
  unsubPartial = window.opengal.asr.onPartial((text) => {
    useASRStore.setState({ partial: text })
  })
  unsubFinal = window.opengal.asr.onFinal((text) => {
    useASRStore.setState({ partial: '' })
    onFinalCallback?.(text)
  })
  return () => {
    unsubSpeechStart?.()
    unsubSpeechStart = null
    unsubPartial?.()
    unsubFinal?.()
    unsubPartial = null
    unsubFinal = null
  }
}
