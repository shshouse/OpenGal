import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pending = []
const played = []
let stops = 0
let cancels = 0
let directorCancels = 0
let sending = true
let model = { speak: (url, callbacks) => played.push({ url, callbacks }), stopSpeaking: () => { stops++ } }
globalThis.__voiceTest = {
  chat: { getState: () => ({ isSending: sending }) },
  logs: { getState: () => ({ appendLocal() {} }) },
  live2d: { getLive2DModel: () => model, applyEmotion() {}, playMotionGroup() {} },
  cancelDirector: () => { directorCancels++ },
}
globalThis.window = { opengal: { tts: {
  speak: (request) => new Promise((resolve) => pending.push({ request, resolve })),
  cancel: async () => { cancels++ },
} } }
class FakeAudio extends EventTarget {
  static instances = []
  constructor(url) { super(); this.url = url; this.paused = false; FakeAudio.instances.push(this) }
  play() { return Promise.resolve() }
  pause() { this.paused = true }
}
globalThis.Audio = FakeAudio
const bundled = await build({
  stdin: { contents: `export * from './renderer/src/features/pipeline/bargeIn'; export * from './renderer/src/features/pipeline/ttsWorker'; export * from './renderer/src/features/pipeline/uiWorker'; export { pipelineBus } from './renderer/src/features/pipeline/pipelineBus';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'voice-boundaries', setup(builder) {
    builder.onResolve({ filter: /^@\/features\/(chat\/chatStore|logs\/logsStore|live2d\/live2dBus)$/ }, (args) => ({ path: args.path, namespace: 'mock' }))
    builder.onResolve({ filter: /\.\/directorWorker$/ }, () => ({ path: 'director', namespace: 'mock' }))
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ loader: 'js', contents:
      args.path.includes('chatStore') ? 'export const useChatStore = globalThis.__voiceTest.chat'
        : args.path.includes('logsStore') ? 'export const useLogsStore = globalThis.__voiceTest.logs'
          : args.path === 'director' ? 'export const cancelDirectorPending = () => globalThis.__voiceTest.cancelDirector()'
            : 'export const { getLive2DModel, applyEmotion, playMotionGroup } = globalThis.__voiceTest.live2d',
    }))
  } }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, module, module.exports)
const { pipelineBus, startTTSWorker, stopTTSWorker, startUIWorker, stopUIWorker, startBargeInBridge, consumeVoiceInterruption, isUIBusy, isTTSBusy } = module.exports
const flush = () => new Promise((resolve) => setImmediate(resolve))
startTTSWorker()
startUIWorker()
const stopBridge = startBargeInBridge()
const output = (url) => ({ audioUrl: url, name: 'role', text: '台词' })
const finishTTS = (index) => pending[index].resolve({ success: true, data: { audioBase64: 'test', mimeType: 'audio/wav' } })

pipelineBus.emit('llm:dialog', { name: 'role', text: '旧回复' })
assert.equal(pending.length, 1)
pipelineBus.emit('user:speechStart', undefined)
assert.equal(cancels, 1)
assert.equal(consumeVoiceInterruption(), true)
assert.equal(consumeVoiceInterruption(), false)
finishTTS(0)
await flush()
assert.equal(played.length, 0, 'late old TTS audio is discarded')
assert.equal(isTTSBusy(), false)

pipelineBus.emit('llm:dialog', { name: 'role', text: '新回复' })
finishTTS(1)
await flush()
assert.equal(played.length, 1)
pipelineBus.emit('tts:output', output('queued-old'))
pipelineBus.emit('user:speechStart', undefined)
assert.equal(stops, 1, 'Live2D speech stops synchronously on speech onset')
await flush()
assert.equal(isUIBusy(), false, 'cancellation releases the playback waiter')
assert.equal(played.length, 1, 'queued old speech never starts')

pipelineBus.emit('tts:output', output('new-after-interruption'))
assert.equal(played.length, 2)
played[0].callbacks.onFinish()
pipelineBus.emit('pipeline:abort', undefined)
assert.equal(stops, 2, 'late callback from old playback cannot steal cancellation of new speech')
await flush()

model = null
pipelineBus.emit('tts:output', output('fallback'))
const audio = FakeAudio.instances.at(-1)
pipelineBus.emit('user:speechStart', undefined)
assert.equal(audio.paused, true)
await flush()
assert.equal(isUIBusy(), false, 'fallback playback cannot leave the queue hung')

pipelineBus.emit('tts:output', output('typed-interruption'))
pipelineBus.emit('user:input', { text: 'new typed input' })
await flush()
assert.equal(FakeAudio.instances.at(-1).paused, true)
assert.equal(isUIBusy(), false)
assert.equal(consumeVoiceInterruption(), false)
assert.ok(directorCancels > 0)
sending = false
const cancelCount = cancels
pipelineBus.emit('user:speechStart', undefined)
assert.equal(cancels, cancelCount, 'idle speech does not cancel a nonexistent reply')
stopBridge()
stopTTSWorker()
stopUIWorker()

let backendSignal
globalThis.__voiceTest.adapter = {
  checkAvailability: () => ({ ok: true }),
  generateSpeech: ({ signal }) => {
    backendSignal = signal
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  },
}
const backend = await build({
  stdin: { contents: `export { speak, cancelSpeech } from './main/services/ttsClient';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'tts-boundaries', setup(builder) {
    builder.onResolve({ filter: /\/(configStore|roleCardLoader|ttsServer|logBus|tts\/factory)$/ }, (args) => ({ path: args.path, namespace: 'backend-mock' }))
    builder.onLoad({ filter: /.*/, namespace: 'backend-mock' }, (args) => ({ loader: 'js', contents:
      args.path.endsWith('configStore') ? 'export const readConfig = () => ({ tts: { enabled: true, provider: "genie" }, activeCharacterId: null })'
        : args.path.endsWith('roleCardLoader') ? 'export const getRoleCard = () => null'
          : args.path.endsWith('ttsServer') ? 'export const startGptSovitsServer = async () => {}'
            : args.path.endsWith('logBus') ? 'export const logBus = { info() {}, warn() {}, error() {} }'
              : 'export const chooseTTSAdapter = () => globalThis.__voiceTest.adapter; export const resetAllTTSAdapters = () => {}',
    }))
  } }],
})
const backendModule = { exports: {} }
new Function('require', 'module', 'exports', backend.outputFiles[0].text)(require, backendModule, backendModule.exports)
const request = backendModule.exports.speak({ text: 'old speech' })
backendModule.exports.cancelSpeech()
assert.equal(backendSignal.aborted, true, 'main-process cancellation reaches the active adapter')
assert.equal((await request).skipped, true, 'cancelled inference is a skipped segment, not a playback error')
globalThis.__voiceTest.adapter.generateSpeech = async () => ({ audioBase64: 'new', mimeType: 'audio/wav' })
assert.equal((await backendModule.exports.speak({ text: 'new speech' })).audioBase64, 'new', 'next inference still succeeds')
console.log('barge-in selfcheck passed')
