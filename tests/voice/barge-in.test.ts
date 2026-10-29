import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  sending: true,
  cancels: 0,
  stops: 0,
  directorCancels: 0,
  pending: [] as Array<{ request: unknown; resolve: (value: unknown) => void }>,
  played: [] as Array<{ url: string; callbacks: Record<string, () => void> }>,
  model: null as null | { speak: (url: string, callbacks: Record<string, () => void>) => void; stopSpeaking: () => void },
  audioInstances: [] as FakeAudio[],
}))

class FakeAudio extends EventTarget {
  paused = false
  constructor(public url: string) {
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

vi.mock('@/features/chat/chatStore', () => ({
  useChatStore: { getState: () => ({ isSending: state.sending }) },
}))
vi.mock('@/features/logs/logsStore', () => ({
  useLogsStore: { getState: () => ({ appendLocal: () => {} }) },
}))
vi.mock('@/features/live2d/live2dBus', () => ({
  getLive2DModel: () => state.model,
  applyEmotion: () => {},
  playMotionGroup: () => {},
}))
vi.mock('../../src/renderer/src/features/pipeline/directorWorker', () => ({
  cancelDirectorPending: () => {
    state.directorCancels++
  },
}))

describe('voice barge-in and playback cancellation', () => {
  let pipelineBus: typeof import('../../src/renderer/src/features/pipeline/pipelineBus').pipelineBus
  let startTTSWorker: typeof import('../../src/renderer/src/features/pipeline/ttsWorker').startTTSWorker
  let stopTTSWorker: typeof import('../../src/renderer/src/features/pipeline/ttsWorker').stopTTSWorker
  let isTTSBusy: typeof import('../../src/renderer/src/features/pipeline/ttsWorker').isTTSBusy
  let startUIWorker: typeof import('../../src/renderer/src/features/pipeline/uiWorker').startUIWorker
  let stopUIWorker: typeof import('../../src/renderer/src/features/pipeline/uiWorker').stopUIWorker
  let isUIBusy: typeof import('../../src/renderer/src/features/pipeline/uiWorker').isUIBusy
  let startBargeInBridge: typeof import('../../src/renderer/src/features/pipeline/bargeIn').startBargeInBridge
  let consumeVoiceInterruption: typeof import('../../src/renderer/src/features/pipeline/bargeIn').consumeVoiceInterruption
  let stopBridge: () => void

  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
  const output = (url: string): import('@shared/messages').TTSOutputMessage => ({
    segmentId: url,
    characterId: 'role',
    name: 'role',
    text: '台词',
    audioUrl: url,
    assetId: '-1',
    isSystem: false,
    isFinalSegment: true,
    turnStartedAt: 0,
  })
  const finishTTS = (index: number): void => {
    state.pending[index].resolve({ success: true, data: { audioBase64: 'test', mimeType: 'audio/wav' } })
  }

  beforeAll(async () => {
    vi.stubGlobal('window', {
      opengal: {
        tts: {
          speak: (request: unknown) =>
            new Promise((resolve) => {
              state.pending.push({ request, resolve })
            }),
          cancel: async () => {
            state.cancels++
          },
        },
      },
    })
    vi.stubGlobal('Audio', FakeAudio)
    state.model = {
      speak: (url, callbacks) => state.played.push({ url, callbacks }),
      stopSpeaking: () => {
        state.stops++
      },
    }
    const bus = await import('../../src/renderer/src/features/pipeline/pipelineBus')
    pipelineBus = bus.pipelineBus
    const tts = await import('../../src/renderer/src/features/pipeline/ttsWorker')
    startTTSWorker = tts.startTTSWorker
    stopTTSWorker = tts.stopTTSWorker
    isTTSBusy = tts.isTTSBusy
    const ui = await import('../../src/renderer/src/features/pipeline/uiWorker')
    startUIWorker = ui.startUIWorker
    stopUIWorker = ui.stopUIWorker
    isUIBusy = ui.isUIBusy
    const barge = await import('../../src/renderer/src/features/pipeline/bargeIn')
    startBargeInBridge = barge.startBargeInBridge
    consumeVoiceInterruption = barge.consumeVoiceInterruption

    startTTSWorker()
    startUIWorker()
    stopBridge = startBargeInBridge()
  })

  afterAll(() => {
    stopBridge?.()
    stopTTSWorker?.()
    stopUIWorker?.()
    vi.unstubAllGlobals()
  })

  it('插话丢弃旧 TTS 结果，且不吞掉新一代队列', async () => {
    pipelineBus.emit('llm:dialog', { name: 'role', text: '旧回复' })
    expect(state.pending).toHaveLength(1)
    pipelineBus.emit('user:speechStart', undefined)
    expect(state.cancels).toBe(1)
    expect(consumeVoiceInterruption()).toBe(true)
    expect(consumeVoiceInterruption()).toBe(false)
    finishTTS(0)
    await flush()
    expect(state.played).toHaveLength(0)
    expect(isTTSBusy()).toBe(false)

    pipelineBus.emit('llm:dialog', { name: 'role', text: '新回复' })
    finishTTS(1)
    await flush()
    expect(state.played).toHaveLength(1)

    pipelineBus.emit('tts:output', output('queued-old'))
    pipelineBus.emit('user:speechStart', undefined)
    expect(state.stops).toBe(1)
    await flush()
    expect(isUIBusy()).toBe(false)
    expect(state.played).toHaveLength(1)

    pipelineBus.emit('tts:output', output('new-after-interruption'))
    expect(state.played).toHaveLength(2)
    state.played[0].callbacks.onFinish()
    pipelineBus.emit('pipeline:abort', undefined)
    expect(state.stops).toBe(2)
    await flush()

    state.model = null
    pipelineBus.emit('tts:output', output('fallback'))
    const audio = state.audioInstances.at(-1)!
    pipelineBus.emit('user:speechStart', undefined)
    expect(audio.paused).toBe(true)
    await flush()
    expect(isUIBusy()).toBe(false)

    pipelineBus.emit('tts:output', output('typed-interruption'))
    pipelineBus.emit('user:input', { text: 'new typed input' })
    await flush()
    expect(state.audioInstances.at(-1)!.paused).toBe(true)
    expect(isUIBusy()).toBe(false)
    expect(consumeVoiceInterruption()).toBe(false)
    expect(state.directorCancels).toBeGreaterThan(0)
  })

  it('空闲开口不清空旧标记，忙时开口算插话', () => {
    state.sending = true
    pipelineBus.emit('user:speechStart', undefined)
    expect(consumeVoiceInterruption()).toBe(true)
    pipelineBus.emit('user:speechStart', undefined)
    state.sending = false
    const cancelCount = state.cancels
    pipelineBus.emit('user:speechStart', undefined)
    expect(state.cancels).toBe(cancelCount)
    expect(consumeVoiceInterruption()).toBe(false)
  })

  it('立绘只在语音实际播放期间收到角色状态', async () => {
    state.model = null
    const events: Array<{ speaking: boolean; characterId?: string }> = []
    const off = pipelineBus.on('tts:playback', (event) => events.push(event))
    pipelineBus.emit('tts:output', output('sprite-audio'))
    const audio = state.audioInstances.at(-1)!
    expect(events).toEqual([])
    audio.dispatchEvent(new Event('playing'))
    expect(events).toEqual([{ speaking: true, characterId: 'role' }])
    audio.dispatchEvent(new Event('ended'))
    await flush()
    expect(events).toEqual([
      { speaking: true, characterId: 'role' },
      { speaking: false, characterId: 'role' },
    ])
    off()
  })

  it('静音段等待期间的 abort 不吞掉新一代队列', async () => {
    const playedBefore = state.audioInstances.length
    pipelineBus.emit('llm:dialog', { name: 'role', text: '无声段' })
    await flush()
    state.pending[state.pending.length - 1].resolve({ success: true, data: { skipped: true, audioBase64: '', mimeType: '' } })
    await flush()
    await flush()
    pipelineBus.emit('pipeline:abort', undefined)
    const abortAt = Date.now()
    pipelineBus.emit('llm:dialog', { name: 'role', text: '插话后的新段' })
    await flush()
    state.pending[state.pending.length - 1].resolve({ success: true, data: { audioBase64: 'after-abort', mimeType: 'audio/wav' } })
    await flush()
    await flush()
    expect(state.audioInstances.length).toBe(playedBefore + 1)
    expect(Date.now() - abortAt).toBeLessThan(1000)
  })
})
