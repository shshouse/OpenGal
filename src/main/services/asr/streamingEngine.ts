import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { logBus } from '../logBus'
import { readConfig } from '../configStore'
import { getDataRoot, getModRoot, getResourceRoot } from '../paths'
import { resolveSherpaPython } from './sherpaEngine'
import type { ASREngine, ASRResultCallback } from './types'
import workerSrc from './sherpa_streaming_worker.py?raw'

const MODEL_PREFIX = 'sherpa-onnx-streaming-zipformer-'

let child: ChildProcess | null = null
let running = false
let resultCallback: ASRResultCallback | null = null
let speechStartCallback: (() => void) | null = null
let lineBuf = ''
let startup: { resolve: () => void; reject: (e: Error) => void } | null = null

export function setResultCallback(cb: ASRResultCallback | null): void {
  resultCallback = cb
}

function writeWorkerScript(): string {
  const dir = path.join(getDataRoot(), 'cache')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'sherpa_streaming_worker.py')
  fs.writeFileSync(file, workerSrc, 'utf-8')
  return file
}

function resolveConfiguredPath(configured: string): string | null {
  if (!configured) return null
  if (path.isAbsolute(configured)) return fs.existsSync(configured) ? configured : null
  return [
    path.join(getModRoot(), configured),
    path.join(getResourceRoot(), configured),
    path.join(app.getAppPath(), configured)
  ].find((p) => fs.existsSync(p)) ?? null
}

function resolveStreamingModelPath(configured: string): string {
  const direct = resolveConfiguredPath(configured)
  if (direct) return direct
  for (const root of [
    path.join(getResourceRoot(), 'models', 'asr'),
    path.join(getModRoot(), 'STT', 'models')
  ]) {
    try {
      const found = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith(MODEL_PREFIX))
        .map((d) => path.join(root, d.name))
      if (found.length > 0) return found[0]
    } catch {
      /* try next root */
    }
  }
  throw new Error(`流式模式需要 ${MODEL_PREFIX} 模型目录，请在设置中指定`)
}

export async function startStreamingASR(): Promise<void> {
  if (running) return
  const config = readConfig().asr
  const modelPath = resolveStreamingModelPath(config.modelPath)
  const python = resolveSherpaPython()
  const script = writeWorkerScript()
  const threads = String(Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2))))

  child = spawn(python[0], [...python.slice(1), '-u', script, modelPath, String(config.sampleRate), String(config.vadSilenceMs), threads], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  const launched = child
  let stderrBuf = ''
  lineBuf = ''

  child.stdout!.on('data', (chunk: Buffer) => {
    if (child !== launched) return
    lineBuf += chunk.toString()
    const lines = lineBuf.split('\n')
    lineBuf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line) as {
          type: 'ready' | 'partial' | 'final' | 'speech_start' | 'error'
          text?: string
          message?: string
        }
        if (msg.type === 'ready') {
          startup?.resolve()
          startup = null
          continue
        }
        if (msg.type === 'speech_start') {
          speechStartCallback?.()
          continue
        }
        if (msg.type === 'error') {
          logBus.warn('asr', msg.message ?? '')
          continue
        }
        if (msg.text?.trim()) {
          resultCallback?.(msg.text.trim(), msg.type === 'partial')
        }
      } catch {
        /* skip malformed */
      }
    }
  })

  child.stderr!.on('data', (chunk: Buffer) => {
    if (child !== launched) return
    const text = chunk.toString().trim()
    stderrBuf += text + '\n'
    if (text) logBus.warn('asr', text)
  })

  child.on('exit', (code) => {
    if (child !== launched) return
    if (startup) {
      startup.reject(new Error(`流式 ASR 启动失败 (code=${code}): ${stderrBuf.slice(-300).trim() || '无错误输出'}`))
      startup = null
    }
    if (running) {
      logBus.warn('asr', `流式 ASR 退出 code=${code}`)
      running = false
      child = null
    }
  })

  running = true
  logBus.info('asr', `流式 ASR 已启动 (model=${modelPath}, threads=${threads})`)
  await new Promise<void>((resolve, reject) => {
    startup = { resolve, reject }
    setTimeout(() => {
      if (startup) {
        startup = null
        reject(new Error('流式语音识别模型加载超时'))
      }
    }, 60_000)
  })
}

export function stopStreamingASR(): void {
  running = false
  startup = null
  if (child && !child.killed) {
    try { child.kill() } catch { /* ignore */ }
  }
  child = null
}

export function feedStreamingAudio(pcm16: Buffer): void {
  if (!running || !child || child.killed) return
  try {
    child.stdin!.write(pcm16)
  } catch {
    /* broken pipe */
  }
}

export function isStreamingASRRunning(): boolean {
  return running
}

const engine: ASREngine = {
  start: () => startStreamingASR(),
  stop: () => stopStreamingASR(),
  feed: (pcm16) => feedStreamingAudio(pcm16),
  isRunning: () => isStreamingASRRunning(),
  setResultCallback: (cb) => setResultCallback(cb),
  setSpeechStartCallback: (cb) => { speechStartCallback = cb }
}

export default engine
