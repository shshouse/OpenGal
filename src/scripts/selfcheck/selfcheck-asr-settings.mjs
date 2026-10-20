import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { EventEmitter } from 'node:events'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
let config = { engine: 'sherpa', enabled: true, modelPath: 'model', language: 'zh', sampleRate: 16000, deviceId: 'mic-a', autoSend: true, hotwords: [], vadSilenceMs: 600, directorEnabled: false, directorScreenContext: false, directorCooldownSec: 20 }
let starts = 0
let stops = 0
let delayStart = null
let failStart = false
const microphones = []
globalThis.__asrMic = { start: async (rate, device) => microphones.push({ rate, device }), stop() {} }
globalThis.window = { opengal: {
  config: { get: async () => ({ success: true, data: { asr: { ...config } } }) },
  asr: {
    start: async () => { starts++; if (delayStart) await delayStart; return failStart ? { success: false, error: 'model failed' } : { success: true } },
    stop: async () => { stops++; return { success: true } },
  },
} }
const result = await build({
  stdin: { contents: `export * from './renderer/src/features/asr/asrStore'; export * from './shared/asrSettings'; export { pipelineBus } from './renderer/src/features/pipeline/pipelineBus';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'asr-settings-boundaries', setup(builder) {
    builder.onResolve({ filter: /^@shared\// }, (args) => ({ path: path.join(root, 'shared', args.path.slice(8) + '.ts') }))
    builder.onResolve({ filter: /^@\/features\/pipeline\/pipelineBus$/ }, () => ({ path: path.join(root, 'renderer/src/features/pipeline/pipelineBus.ts') }))
    builder.onResolve({ filter: /\.\/micCapture$/ }, () => ({ path: 'mic', namespace: 'mock' }))
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const startMicCapture = (...args) => globalThis.__asrMic.start(...args); export const stopMicCapture = () => globalThis.__asrMic.stop();', loader: 'js' }))
  } }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
const { useASRStore, needsASRRestart, pipelineBus } = module.exports
const store = () => useASRStore.getState()
let settingsEvents = 0
pipelineBus.on('asr:settingsChanged', () => { settingsEvents++ })
await store().applySettings(config)
assert.equal(starts, 0, 'editing settings must not open an idle microphone')
await store().start()
assert.equal(microphones.at(-1).device, 'mic-a')
assert.equal(store().running, true)
config = { ...config, autoSend: false, directorEnabled: true }
await store().applySettings(config)
assert.equal(starts, 1, 'behavior settings do not restart the recognition model')
assert.equal(store().settings.autoSend, false)
assert.equal(store().settings.directorEnabled, true)
assert.equal(settingsEvents, 2)
config = { ...config, deviceId: 'mic-b' }
await store().applySettings(config)
assert.equal(microphones.at(-1).device, 'mic-b', 'device changes replace the actual capture device')
assert.ok(stops > 0)
config = { ...config, language: 'en', vadSilenceMs: 350 }
await store().applySettings(config)
assert.equal(store().settings.language, 'en')
assert.equal(store().settings.vadSilenceMs, 350)
assert.equal(starts, 3)
assert.equal(needsASRRestart(config, { ...config, directorCooldownSec: 4 }), false)
assert.equal(needsASRRestart(config, { ...config, hotwords: ['Miku'] }), true)
config = { ...config, deviceId: 'mic-c' }
const earlier = store().applySettings(config)
config = { ...config, deviceId: 'mic-d' }
const latest = store().applySettings(config)
await Promise.all([earlier, latest])
assert.equal(microphones.at(-1).device, 'mic-d', 'rapid changes end on the latest device')
failStart = true
config = { ...config, modelPath: 'bad-model' }
await assert.rejects(store().applySettings(config), /model failed/)
assert.equal(store().running, false)
assert.equal(store().error, 'model failed')
failStart = false
config = { ...config, modelPath: 'working-model' }
await store().applySettings(config)
assert.equal(store().running, true, 'fixing an invalid running configuration retries automatically')
await store().stop()
let release
delayStart = new Promise((resolve) => { release = resolve })
const starting = store().start()
await new Promise((resolve) => setImmediate(resolve))
const count = microphones.length
const stopping = store().stop()
release()
await Promise.all([starting, stopping])
assert.equal(store().running, false)
assert.equal(microphones.length, count, 'stopping during model load must not reopen the microphone')

const children = []
const cleanupTimers = []
class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  writes = 0
  stdin = { end() {}, write: () => { this.writes++ } }
  kill() { this.killed = true; this.emit('exit', 0) }
}
globalThis.__asrWorker = {
  spawn: () => { const child = new FakeChild(); children.push(child); return child },
  config: () => ({ asr: config }),
}
const workerBuild = await build({
  stdin: { contents: `export * from './main/services/asr/sherpaEngine';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'asr-process-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(node:child_process|node:fs|electron)$|\/(logBus|configStore|paths)$|sherpa_worker\.py\?raw$/ }, (args) => ({ path: args.path, namespace: 'worker-mock' }))
    builder.onLoad({ filter: /.*/, namespace: 'worker-mock' }, (args) => ({ loader: 'js', contents:
      args.path === 'node:child_process' ? 'export const spawn = () => globalThis.__asrWorker.spawn(); export const execFileSync = () => {}'
        : args.path === 'node:fs' ? 'export default { existsSync: () => true, mkdirSync() {}, writeFileSync() {}, readdirSync: () => [] }'
          : args.path === 'electron' ? 'export const app = { getAppPath: () => "app" }'
            : args.path.endsWith('logBus') ? 'export const logBus = { info() {}, warn() {}, debug() {} }'
              : args.path.endsWith('configStore') ? 'export const readConfig = () => globalThis.__asrWorker.config()'
                : args.path.endsWith('paths') ? 'export const getModRoot = () => "mods"; export const getDataRoot = () => "data"; export const getResourceRoot = () => "resources";'
                  : 'export default ""',
    }))
  } }],
})
const workerModule = { exports: {} }
new Function('require', 'module', 'exports', workerBuild.outputFiles[0].text)(require, workerModule, workerModule.exports)
const worker = workerModule.exports
const realTimeout = globalThis.setTimeout
globalThis.setTimeout = (callback, ms, ...args) => {
  if (ms === 2000) { cleanupTimers.push(callback); return { fake: true } }
  return realTimeout(callback, ms, ...args)
}
try {
  const firstStart = worker.startASR()
  children[0].stdout.emit('data', Buffer.from('{"type":"ready"}\n'))
  await firstStart
  worker.stopASR()
  const secondStart = worker.startASR()
  children[1].stdout.emit('data', Buffer.from('{"type":"ready"}\n'))
  await secondStart
  let results = 0
  worker.setResultCallback(() => { results++ })
  children[0].stdout.emit('data', Buffer.from('{"type":"final","text":"stale"}\n'))
  children[0].emit('exit', 0)
  cleanupTimers.shift()()
  assert.equal(children[0].killed, true)
  assert.equal(children[1].killed, false, 'old delayed cleanup must not kill the replacement recognizer')
  assert.equal(results, 0, 'retired recognizer transcripts must not reach the new session')
  assert.equal(worker.isASRRunning(), true)
  worker.feedAudio(Buffer.alloc(16))
  assert.equal(children[1].writes, 1)
  worker.stopASR()
  cleanupTimers.shift()()
} finally { globalThis.setTimeout = realTimeout }
console.log('ASR live settings selfcheck passed')
