import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = { write: () => { state.writes++ }, end: () => {} }
  killed = false
  kill(): void {
    this.killed = true
    this.emit('exit', 0)
  }
}

const state = vi.hoisted(() => ({
  children: [] as FakeChild[],
  writes: 0,
  spawnImpl: (() => {}) as unknown as () => FakeChild,
}))

vi.mock('node:child_process', () => ({
  spawn: () => state.spawnImpl(),
  execFileSync: () => {},
}))
vi.mock('node:fs', () => ({
  default: { existsSync: () => true, mkdirSync: () => {}, writeFileSync: () => {}, readdirSync: () => [] },
}))
vi.mock('electron', () => ({ app: { getAppPath: () => 'app' } }))
vi.mock('../../src/main/services/logBus', () => ({
  logBus: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))
vi.mock('../../src/main/services/configStore', () => ({
  readConfig: () => ({
    asr: { engine: 'sherpa', mode: 'offline', modelPath: '/model', sampleRate: 16000, language: 'zh', vadSilenceMs: 600, hotwords: [] },
  }),
}))
vi.mock('../../src/main/services/paths', () => ({
  getModRoot: () => 'mods',
  getDataRoot: () => 'data',
  getResourceRoot: () => 'resources',
}))

describe('sherpaEngine process lifecycle', () => {
  const cleanupTimers: Array<() => void> = []
  const realSetTimeout = globalThis.setTimeout
  let engine: typeof import('../../src/main/services/asr/sherpaEngine')

  beforeAll(async () => {
    state.spawnImpl = () => {
      const child = new FakeChild()
      state.children.push(child)
      return child
    }
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms?: number) => {
      if (ms === 2000) {
        cleanupTimers.push(callback)
        return 0 as unknown as ReturnType<typeof setTimeout>
      }
      return realSetTimeout(callback, ms) as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)
    engine = await import('../../src/main/services/asr/sherpaEngine')
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('旧识别器的延迟清理不会杀掉新进程，迟到结果不进入新会话', async () => {
    const first = engine.startASR()
    state.children[0].stdout.emit('data', Buffer.from('{"type":"ready"}\n'))
    await first

    engine.stopASR()
    const second = engine.startASR()
    state.children[1].stdout.emit('data', Buffer.from('{"type":"ready"}\n'))
    await second

    let results = 0
    engine.setResultCallback(() => {
      results++
    })
    state.children[0].stdout.emit('data', Buffer.from('{"type":"final","text":"stale"}\n'))
    state.children[0].emit('exit', 0)
    cleanupTimers.shift()?.()

    expect(state.children[0].killed).toBe(true)
    expect(state.children[1].killed).toBe(false)
    expect(results).toBe(0)
    expect(engine.isASRRunning()).toBe(true)

    engine.feedAudio(Buffer.alloc(16))
    expect(state.writes).toBe(1)

    engine.stopASR()
    cleanupTimers.shift()?.()
  })
})
