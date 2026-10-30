import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  running: false,
  eyes: [] as boolean[],
  inputs: [] as Array<{ text: string }>,
}))

vi.mock('../../src/renderer/src/features/live2d/live2dBus', () => ({
  setEyesClosed: (closed: boolean) => state.eyes.push(closed),
}))
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
  useCharacterRuntimeStore: { getState: () => ({ byId: { sonetto: state.running } }) },
}))
vi.mock('../../src/renderer/src/features/character/characterStore', () => ({
  useCharacterStore: { getState: () => ({ activeId: 'sonetto' }) },
}))

async function boot(): Promise<void> {
  const mod = await import('../../src/renderer/src/features/startup/startupStore')
  mod.useStartupStore.getState().beginBoot()
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(700)
}

describe('startup boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.eyes = []
    state.inputs = []
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
          get: async () => ({ success: true, data: { startup: { greetingEnabled: true } } }),
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

  it('用户没有唤醒意图时模块完成不睁眼也不问候', async () => {
    state.running = false
    await boot()

    expect(state.eyes).toEqual([])
    expect(state.inputs).toEqual([])
  })

  it('主动问候保持中性且不添加主从称呼', async () => {
    state.running = true
    await boot()

    expect(state.eyes).toEqual([])
    expect(state.inputs).toHaveLength(1)
    expect(state.inputs[0].text).not.toContain('主人')
    expect(state.inputs[0].text).toContain('符合角色设定')
  })
})
