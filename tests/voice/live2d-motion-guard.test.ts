import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  startRandomMotion: null as null | ((group: string, priority: number) => Promise<boolean>),
  currentAudio: { ended: false } as { ended: boolean } | undefined,
}))

vi.mock('@/features/logs/logsStore', () => ({
  useLogsStore: { getState: () => ({ appendLocal: () => {} }) },
}))

describe('动作播放不得抢占语音', () => {
  beforeAll(async () => {
    vi.stubGlobal('window', {})
    const bus = await import('../../src/renderer/src/features/live2d/live2dBus')
    state.startRandomMotion = vi.fn(async () => true)
    bus.registerLive2DModel({
      speak: () => {},
      stopSpeaking: () => {},
      internalModel: {
        motionManager: {
          definitions: { click: [{}], Idle: [{}] },
          startRandomMotion: state.startRandomMotion,
          isFinished: () => true,
          get currentAudio() {
            return state.currentAudio
          },
        },
      },
    } as unknown as Parameters<typeof bus.registerLive2DModel>[0])
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('语音播放期间忽略动作请求，避免销毁 currentAudio', async () => {
    const bus = await import('../../src/renderer/src/features/live2d/live2dBus')
    state.currentAudio = { ended: false }
    bus.playMotionGroup('click')
    expect(state.startRandomMotion).not.toHaveBeenCalled()
  })

  it('语音结束后动作照常播放', async () => {
    const bus = await import('../../src/renderer/src/features/live2d/live2dBus')
    state.currentAudio = { ended: true }
    bus.playMotionGroup('click')
    expect(state.startRandomMotion).toHaveBeenCalledWith('click', 3)
  })
})
