import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  activeId: 'a',
  byId: { a: true, b: true } as Record<string, boolean>,
  inputs: [] as Array<{ text: string }>,
  resolveConfig: null as null | ((value: unknown) => void),
  configPromise: null as null | Promise<unknown>,
}))

vi.mock('../../src/renderer/src/features/live2d/live2dBus', () => ({ setEyesClosed: () => {} }))
vi.mock('../../src/renderer/src/features/pipeline/pipelineBus', () => ({
  pipelineBus: { emit: (event: string, payload: { text: string }) => {
    if (event === 'user:input') state.inputs.push(payload)
  } },
}))
vi.mock('../../src/renderer/src/features/chat/chatStore', () => ({
  useChatStore: { getState: () => ({ setSending: () => {} }) },
}))
vi.mock('../../src/renderer/src/features/logs/logsStore', () => ({
  useLogsStore: { getState: () => ({ appendLocal: () => {} }) },
}))
vi.mock('../../src/renderer/src/features/character/characterRuntimeStore', () => ({
  useCharacterRuntimeStore: { getState: () => ({ byId: state.byId }) },
}))
vi.mock('../../src/renderer/src/features/character/characterStore', () => ({
  useCharacterStore: {
    getState: () => ({ activeId: state.activeId, list: [{ id: 'a', language: 'ja' }, { id: 'b', language: 'ja' }] }),
  },
}))

async function loadStore() {
  const mod = await import('../../src/renderer/src/features/startup/startupStore')
  mod.useStartupStore.getState().beginBoot()
  await vi.advanceTimersByTimeAsync(0)
  return mod
}

describe('startup races', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.activeId = 'a'
    state.byId = { a: true, b: true }
    state.inputs = []
    state.resolveConfig = null
    state.configPromise = null
    vi.stubGlobal('window', {
      opengal: {
        boot: {
          onStep: () => {},
          start: async () => ({
            success: true,
            data: {
              llmConfigured: true,
              steps: [
                { id: 'live2d', label: 'Live2D', status: 'ok' },
                { id: 'memory', label: '记忆', status: 'ok' },
                { id: 'tts', label: 'TTS', status: 'ok' },
              ],
            },
          }),
        },
        config: {
          get: () => {
            if (!state.configPromise) {
              state.configPromise = new Promise((resolve) => { state.resolveConfig = resolve })
            }
            return state.configPromise
          },
        },
      },
      setTimeout,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('并发唤醒只发送一次问候', async () => {
    const mod = await loadStore()
    const first = mod.maybeGreet()
    const second = mod.maybeGreet()
    state.resolveConfig!({ success: true, data: { startup: { greetingEnabled: true } } })
    await Promise.all([first, second])

    expect(state.inputs).toHaveLength(1)
  })

  it('等待配置期间切角色或休眠会丢弃过期问候', async () => {
    const mod = await loadStore()
    const pending = mod.maybeGreet()
    state.activeId = 'b'
    state.byId.a = false
    state.resolveConfig!({ success: true, data: { startup: { greetingEnabled: true } } })
    await pending

    expect(state.inputs).toEqual([])
  })

  it('启动结束后仍接受当前模型的真实失败状态', async () => {
    const mod = await loadStore()
    await vi.advanceTimersByTimeAsync(700)
    mod.useStartupStore.getState().reportLive2d('failed', '当前模型加载失败')

    expect(mod.useStartupStore.getState().steps.find((step) => step.id === 'live2d')?.status).toBe('failed')
  })
})
