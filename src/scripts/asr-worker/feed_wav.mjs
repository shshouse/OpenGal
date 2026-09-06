import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const [modelDir, wavPath] = process.argv.slice(2)
if (!modelDir || !wavPath) {
  console.error('usage: node src/scripts/asr-worker/feed_wav.mjs <modelDir> <clip.wav> [vadPath]')
  console.error('env: WORKER_EXE=... 切换到冻结 exe；WORKER_PY / WORKER_SCRIPT 切换 python')
  process.exit(1)
}
const vadPath =
  process.argv[4] ?? path.join(root, 'mods', 'STT', 'vad', 'silero_vad.onnx')
const language = process.env.ASR_LANG ?? 'auto'
const silenceMs = process.env.ASR_SILENCE_MS ?? '600'
const hotwords = process.env.ASR_HOTWORDS ?? ''

const exe = process.env.WORKER_EXE
const pyParts = (process.env.WORKER_PY ?? 'py -3.12').split(' ')
const workerScript =
  process.env.WORKER_SCRIPT ?? path.join(root, 'src', 'main', 'services', 'asr', 'sherpa_worker.py')
const [program, ...pre] = exe
  ? [exe]
  : [...pyParts, '-u', workerScript]

const workerArgs = [modelDir, '16000', language, vadPath, silenceMs, hotwords, '2']
const child = spawn(program, [...pre, ...workerArgs], {
  stdio: ['pipe', 'inherit', 'inherit']
})
child.on('exit', (code) => process.exit(code ?? 0))

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF wav')
  let off = 12
  let sampleRate = 16000
  let data = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') sampleRate = buf.readUInt32LE(off + 12)
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + size)
    off += 8 + size + (size % 2)
  }
  if (!data) throw new Error('no data chunk')
  return { sampleRate, data }
}

function resampleTo16k(data, sampleRate) {
  if (sampleRate === 16000) return data
  const ratio = sampleRate / 16000
  const inSamples = Math.floor(data.length / 2)
  const outSamples = Math.floor(inSamples / ratio)
  const out = Buffer.alloc(outSamples * 2)
  for (let i = 0; i < outSamples; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, inSamples - 1)
    const frac = pos - i0
    const s0 = data.readInt16LE(i0 * 2)
    const s1 = data.readInt16LE(i1 * 2)
    const v = Math.max(-32768, Math.min(32767, Math.round(s0 + (s1 - s0) * frac)))
    out.writeInt16LE(v, i * 2)
  }
  return out
}

const { sampleRate, data: rawData } = parseWav(readFileSync(wavPath))
const data = resampleTo16k(rawData, sampleRate)
const CHUNK = 4096
const intervalMs = (CHUNK / (16000 * 2)) * 1000
let off = 0
const timer = setInterval(() => {
  if (off >= data.length) {
    clearInterval(timer)
    child.stdin.end()
    return
  }
  child.stdin.write(data.subarray(off, off + CHUNK))
  off += CHUNK
}, intervalMs)
