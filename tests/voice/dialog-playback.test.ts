import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

interface FakeModel {
  speak: (url: string, options?: Record<string, unknown>) => Promise<boolean> | void
  stopSpeaking: () => void
}

class FakeAudio extends EventTarget {
  paused = false
  currentTime = 0
  constructor(public src: string) {
    super()
    state.audioInstances.push(this)
  }
  play(): Promise<void> {
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
}

const state = vi.hoisted(() => ({
  order: [] as string[],
  audioInstances: [] as FakeAudio[],
  speakResult: true,
  model: null as FakeModel | null,
}))

vi.mock('@/features/logs/logsStore', () => ({
  useLogsStore: { getState: () => ({ appendLocal: () => {} }) },
}))
vi.mock('@/features/live2d/live2dBus', () => ({
  getLive2DModel: () => state.model,
  applyEmotion: () => {
    state.order.push('emotion')
  },
  playMotionGroup: (group: string) => {
    state.order.push(`motion:${group}`)
  },
}))

describe('对话配音与动作的先后关系', () => {
  let pipelineBus: typeof import('../../src/renderer/src/features/pipeline/pipelineBus').pipelineBus
  let startUIWorker: typeof import('../../src/renderer/src/features/pipeline/uiWorker').startUIWorker
  let stopUIWorker: typeof import('../../src/renderer/src/features/pipeline/uiWorker').stopUIWorker
  let isUIBusy: typeof import('../../src/renderer/src/features/pipeline/uiWorker').isUIBusy

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
  const output = (motion?: string): import('@shared/messages').TTSOutputMessage => ({
    segmentId: motion ?? 'plain',
    characterId: 'sonetto',
    name: 'sonetto',
    text: 'Hello',
    audioUrl: 'data:audio/wav;base64,AAAA',
    assetId: '-1',
    motion,
    isSystem: false,
    isFinalSegment: true,
    turnStartedAt: 0,
  })

  beforeAll(async () => {
    vi.stubGlobal('window', { opengal: {} })
    vi.stubGlobal('Audio', FakeAudio)
    state.model = {
      speak: (_url, options) => {
        state.order.push('speak')
        if (state.speakResult) {
          void Promise.resolve().then(() => (options?.onFinish as (() => void) | undefined)?.())
        }
        return Promise.resolve(state.speakResult)
      },
      stopSpeaking: () => {
        state.order.push('stopSpeaking')
      },
    }
    const bus = await import('../../src/renderer/src/features/pipeline/pipelineBus')
    pipelineBus = bus.pipelineBus
    const ui = await import('../../src/renderer/src/features/pipeline/uiWorker')
    startUIWorker = ui.startUIWorker
    stopUIWorker = ui.stopUIWorker
    isUIBusy = ui.isUIBusy
    startUIWorker()
  })

  afterAll(() => {
    stopUIWorker?.()
    vi.unstubAllGlobals()
  })

  it('动作先于语音触发，避免动作打断正在播放的音频', async () => {
    state.order.length = 0
    pipelineBus.emit('tts:output', output('kaixin'))
    await flush()
    await flush()
    const motion = state.order.indexOf('motion:kaixin')
    const speak = state.order.indexOf('speak')
    expect(motion).toBeGreaterThanOrEqual(0)
    expect(speak).toBeGreaterThan(motion)
  })

  it('语音被库拒绝时清掉残留并回退到独立 audio，播放队列不卡死', async () => {
    state.speakResult = false
    state.order.length = 0
    const before = state.audioInstances.length
    pipelineBus.emit('tts:output', output('nanguo'))
    await flush()
    await flush()
    expect(state.order).toContain('stopSpeaking')
    expect(state.audioInstances.length).toBe(before + 1)
    const audio = state.audioInstances.at(-1)!
    audio.dispatchEvent(new Event('ended'))
    await flush()
    expect(isUIBusy()).toBe(false)
    state.speakResult = true
  })
})
