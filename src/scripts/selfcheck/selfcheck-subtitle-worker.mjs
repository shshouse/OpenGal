import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const calls = []
const warnings = []
globalThis.__subtitleSession = 'role'
globalThis.__subtitleWarnings = warnings
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = { opengal: {
  config: { get: async () => ({ success: true, data: { systemLocale: 'zh-CN', subtitles: { mode: 'bilingual', targetLanguage: 'system' } } }) },
  llm: { chat: () => new Promise((resolve) => calls.push(resolve)) },
} }
globalThis.window.localStorage = globalThis.localStorage
const result = await build({
  stdin: {
    contents: `export * from './renderer/src/features/pipeline/subtitles'; export { pipelineBus } from './renderer/src/features/pipeline/pipelineBus';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'isolate-subtitle-test', setup(builder) {
    builder.onResolve({ filter: /^@shared\// }, (args) => ({ path: path.join(root, 'shared', args.path.slice(8) + '.ts') }))
    builder.onResolve({ filter: /^@\/features\/(chat\/chatStore|logs\/logsStore)$/ }, (args) => ({ path: args.path, namespace: 'test-store' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-store' }, (args) => ({
      contents: args.path.includes('chatStore')
        ? 'export const useChatStore = { getState: () => ({ sessionId: globalThis.__subtitleSession }) }'
        : 'export const useLogsStore = { getState: () => ({ appendLocal: (...args) => globalThis.__subtitleWarnings.push(args) }) }',
      loader: 'js',
    }))
  } }],
})
const module = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
const { startSubtitleWorker, useSubtitleStore, displaySubtitle, applySubtitleConfig, pipelineBus } = module.exports
const flush = () => new Promise((resolve) => setImmediate(resolve))
const emit = (id, text, turn = 1, language = 'ja') => pipelineBus.emit('llm:dialog', {
  segmentId: id, characterId: 'role', name: 'role', text, turnStartedAt: turn, language,
})
const complete = (index, translation) => calls[index]({ success: true, data: { content: JSON.stringify({ translation }) } })
const stop = startSubtitleWorker()
globalThis.localStorage.setItem = () => { throw new Error('quota exceeded') }
emit('a', 'こんにちは。')
emit('b', '元気？')
await flush()
assert.equal(calls.length, 2, 'translation starts independently for both segments')
complete(1, '还好吗？')
await flush()
complete(0, '你好。')
await flush()
assert.equal(displaySubtitle('role', 'こんにちは。元気？'), 'こんにちは。元気？\n你好。还好吗？', 'out of order results keep source order')
assert.equal(displaySubtitle('role', ' こんにちは。元気？ '), 'こんにちは。元気？\n你好。还好吗？', 'display trimming does not lose subtitles')
emit('c', '古い返事', 2)
await flush()
pipelineBus.emit('pipeline:abort', undefined)
complete(2, '不应出现')
await flush()
assert.equal(displaySubtitle('role', '古い返事'), '古い返事', 'aborted translation is ignored')
emit('d', '切换角色', 3)
await flush()
globalThis.__subtitleSession = 'another-role'
complete(3, '不应串到新角色')
await flush()
assert.equal(displaySubtitle('role', '切换角色'), '切换角色')
globalThis.__subtitleSession = 'role'
emit('mismatched-language', 'And so she kept writing.', 4, 'zh')
await flush()
assert.equal(calls.length, 5, 'Chinese character metadata must not suppress translation of English dialogue')
complete(4, '于是她继续写作。')
await flush()
assert.equal(displaySubtitle('role', 'And so she kept writing.'), 'And so she kept writing.\n于是她继续写作。')
emit('failure', '失敗', 5)
await flush()
calls[5]({ success: false, error: 'test failure' })
await flush()
assert.equal(displaySubtitle('role', '失敗'), '失敗')
assert.equal(warnings.length, 1)
applySubtitleConfig({ systemLocale: 'zh-CN', subtitles: { mode: 'translated', targetLanguage: 'en' } })
assert.equal(displaySubtitle('role', 'こんにちは。元気？'), 'こんにちは。元気？', 'changing target clears old translations')
emit('disposed', '終了', 6)
await flush()
stop()
complete(6, 'not shown')
await flush()
assert.equal(displaySubtitle('role', '終了'), '終了')
const tts = readFileSync(path.join(root, 'renderer/src/features/pipeline/ttsWorker.ts'), 'utf8')
assert.ok(!tts.includes('msg.translate'), 'translated captions never select TTS speech')
console.log('subtitle worker selfcheck passed')
