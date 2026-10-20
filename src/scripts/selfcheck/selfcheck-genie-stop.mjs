import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const projectRoot = path.resolve(root, '..')
const warnings = []
const existing = path.join(projectRoot, 'package.json')
let stopCalls = 0

globalThis.__genieTest = {
  logBus: {
    info() {},
    warn(message) { warnings.push(message) },
    error() {},
  },
}

globalThis.fetch = (url, init = {}) => {
  if (String(url).endsWith('/stop')) {
    stopCalls++
    return Promise.resolve({ ok: true, status: 200 })
  }
  return new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'))
    }, { once: true })
  })
}

const bundled = await build({
  stdin: {
    contents: `export { GenieAdapter } from './main/services/tts/genieAdapter';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  plugins: [{
    name: 'genie-boundaries',
    setup(builder) {
      builder.onResolve({ filter: /^@shared\// }, (args) => ({
        path: path.join(root, 'shared', `${args.path.slice('@shared/'.length)}.ts`),
      }))
      builder.onResolve({ filter: /\/(paths|roleCardLoader|ttsPort|logBus)$/ }, (args) => ({
        path: args.path,
        namespace: 'genie-mock',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'genie-mock' }, (args) => {
        if (args.path.endsWith('paths')) {
          return { loader: 'js', contents: 'export const resolveVoicePath = (p) => p' }
        }
        if (args.path.endsWith('roleCardLoader')) {
          return { loader: 'js', contents: 'export const readRoleVoiceConfig = () => null; export const resolveRoleVoiceFile = (_c, p) => p' }
        }
        if (args.path.endsWith('ttsPort')) {
          return { loader: 'js', contents: 'export const applyTtsPortShift = (u) => u; export const assertLocalBaseURL = () => {}' }
        }
        return { loader: 'js', contents: 'export const logBus = globalThis.__genieTest.logBus' }
      })
    },
  }],
})

const module = { exports: {} }
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, module, module.exports)
const { GenieAdapter } = module.exports

const config = {
  enabled: true,
  provider: 'genie',
  baseURL: 'http://127.0.0.1:39999',
  characterName: 'test',
  onnxModelDir: existing,
  referenceAudioRelPath: existing,
  referenceText: '参考文本',
  referenceLanguage: 'zh',
}

const adapter = new GenieAdapter()
adapter.loadedCharacters.set('http://127.0.0.1:39999', new Set(['test']))

const controller = new AbortController()
const pending = adapter.generateSpeech({
  text: '你好',
  globalConfig: config,
  card: null,
  signal: controller.signal,
})
await new Promise((resolve) => setImmediate(resolve))
controller.abort()
await assert.rejects(pending)
await new Promise((resolve) => setImmediate(resolve))
assert.equal(stopCalls, 1, 'aborting synthesis posts /stop exactly once')
controller.abort()
assert.equal(stopCalls, 1, 'repeated aborts do not post /stop again')
assert.equal(warnings.length, 0, 'successful /stop does not warn')

console.log('genie-stop selfcheck passed')
