import { beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  config: {
    engine: 'sherpa',
    enabled: true,
    modelPath: '/model',
    language: 'zh',
    sampleRate: 16000,
    deviceId: 'mic-a',
    autoSend: true,
    hotwords: [] as string[],
    vadSilenceMs: 600,
    directorEnabled: false,
    directorScreenContext: false,
    directorCooldownSec: 20,
  },
  starts: 0,
  stops: 0,
  microphones: [] as Array<{ rate: number; device?: string }>,
  delayStart: null as Promise<void> | null,
  failStart: false,
}))

vi.mock('@/features/asr/micCapture', () => ({
  startMicCapture: async (rate: number, device?: string) => {
    state.microphones.push({ rate, device })
  },
  stopMicCapture: () => {},
}))

describe('asrStore live settings', () => {
  let store: typeof import('../../src/renderer/src/features/asr/asrStore')
  let needsASRRestart: typeof import('../../src/shared/asrSettings').needsASRRestart
  let pipelineBus: typeof import('../../src/renderer/src/features/pipeline/pipelineBus').pipelineBus

  beforeAll(async () => {
    vi.stubGlobal('window', {
      opengal: {
        config: { get: async () => ({ success: true, data: { asr: { ...state.config } } }) },
        asr: {
          start: async () => {
            state.starts++
            if (state.delayStart) await state.delayStart
            return state.failStart ? { success: false, error: 'model failed' } : { success: true }
          },
          stop: async () => {
            state.stops++
            return { success: true }
          },
        },
      },
    })
    store = await import('../../src/renderer/src/features/asr/asrStore')
    needsASRRestart = (await import('../../src/shared/asrSettings')).needsASRRestart
    pipelineBus = (await import('../../src/renderer/src/features/pipeline/pipelineBus')).pipelineBus
  })

  it('行为设置不重启、设备切换真实切换、失败可恢复', async () => {
    const get = (): ReturnType<typeof store.useASRStore.getState> => store.useASRStore.getState()
    let settingsEvents = 0
    pipelineBus.on('asr:settingsChanged', () => {
      settingsEvents++
    })

    await get().applySettings(state.config as never)
    expect(state.starts).toBe(0)
    await get().start()
    expect(state.microphones.at(-1)?.device).toBe('mic-a')
    expect(get().running).toBe(true)

    state.config = { ...state.config, autoSend: false, directorEnabled: true }
    await get().applySettings(state.config as never)
    expect(state.starts).toBe(1)
    expect(get().settings?.autoSend).toBe(false)
    expect(get().settings?.directorEnabled).toBe(true)
    expect(settingsEvents).toBe(2)

    state.config = { ...state.config, deviceId: 'mic-b' }
    await get().applySettings(state.config as never)
    expect(state.microphones.at(-1)?.device).toBe('mic-b')
    expect(state.stops).toBeGreaterThan(0)

    state.config = { ...state.config, language: 'en', vadSilenceMs: 350 }
    await get().applySettings(state.config as never)
    expect(get().settings?.language).toBe('en')
    expect(get().settings?.vadSilenceMs).toBe(350)
    expect(state.starts).toBe(3)
    expect(needsASRRestart(state.config as never, { ...state.config, directorCooldownSec: 4 } as never)).toBe(false)
    expect(needsASRRestart(state.config as never, { ...state.config, hotwords: ['Miku'] } as never)).toBe(true)

    state.config = { ...state.config, deviceId: 'mic-c' }
    const earlier = get().applySettings(state.config as never)
    state.config = { ...state.config, deviceId: 'mic-d' }
    const latest = get().applySettings(state.config as never)
    await Promise.all([earlier, latest])
    expect(state.microphones.at(-1)?.device).toBe('mic-d')

    state.failStart = true
    state.config = { ...state.config, modelPath: 'bad-model' }
    await expect(get().applySettings(state.config as never)).rejects.toThrow(/model failed/)
    expect(get().running).toBe(false)
    expect(get().error).toBe('model failed')

    state.failStart = false
    state.config = { ...state.config, modelPath: 'working-model' }
    await get().applySettings(state.config as never)
    expect(get().running).toBe(true)

    await get().stop()
    let release!: () => void
    state.delayStart = new Promise<void>((resolve) => {
      release = resolve
    })
    const starting = get().start()
    await new Promise((resolve) => setImmediate(resolve))
    const count = state.microphones.length
    const stopping = get().stop()
    release()
    await Promise.all([starting, stopping])
    expect(get().running).toBe(false)
    expect(state.microphones.length).toBe(count)
    vi.unstubAllGlobals()
  })
})
