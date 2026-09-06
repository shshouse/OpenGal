import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logBus } from '../logBus'
import { readConfig } from '../configStore'
import { getModRoot, getDataRoot } from '../paths'
import type { ASREngine, ASRResultCallback } from './types'
import workerSrc from './sherpa_worker.py?raw'

let child: ChildProcess | null = null
let running = false
let resultCallback: ASRResultCallback | null = null
let lineBuf = ''
let startup: { resolve: () => void; reject: (e: Error) => void } | null = null

export function setResultCallback(cb: ASRResultCallback | null): void {
  resultCallback = cb
}

function resolveSherpaPython(): string[] {
  const candidates: string[][] = [['python'], ['py', '-3.12'], ['py', '-3.11'], ['py', '-3.10']]
  for (const cmd of candidates) {
    try {
      execFileSync(cmd[0], [...cmd.slice(1), '-c', 'import sherpa_onnx'], { stdio: 'ignore', windowsHide: true })
      return cmd
    } catch { /* try next */ }
  }
  throw new Error('未找到安装了 sherpa-onnx 的 Python。请执行: pip install sherpa-onnx numpy')
}

function portableWorkerExe(): string | null {
  const exe = path.join(getModRoot(), 'STT', 'ASRWorker2', 'ASRWorker2.exe')
  return fs.existsSync(exe) ? exe : null
}

function resolveVadModel(): string {
  const rel = path.join('STT', 'vad', 'silero_vad.onnx')
  const found = [path.join(getModRoot(), rel), path.join(app.getAppPath(), rel)].find((p) =>
    fs.existsSync(p)
  )
  if (!found) {
    throw new Error('未找到 silero_vad.onnx，请放置到 mods/STT/vad/silero_vad.onnx')
  }
  return found
}

function writeHotwordsFile(): string {
  const dir = path.join(getDataRoot(), 'cache')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'asr-hotwords.txt')
  fs.writeFileSync(file, readConfig().asr.hotwords.join('\n'), 'utf-8')
  return file
}

function writeWorkerScript(): string {
  const dir = path.join(getDataRoot(), 'cache')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'sherpa_worker.py')
  fs.writeFileSync(file, workerSrc, 'utf-8')
  return file
}

export async function startASR(): Promise<void> {
  if (running) return
  const config = readConfig().asr
  if (!config.modelPath) {
    throw new Error('ASR modelPath 未配置。请在设置中指定 sherpa-onnx 模型目录路径。')
  }
  const modelPath = path.isAbsolute(config.modelPath)
    ? config.modelPath
    : [path.join(getModRoot(), config.modelPath), path.join(app.getAppPath(), config.modelPath)].find(
        (p) => fs.existsSync(p)
      ) ?? path.join(getModRoot(), config.modelPath)
  const vadPath = resolveVadModel()
  const hotwordsFile = writeHotwordsFile()
  const workerArgv = [
    modelPath,
    String(config.sampleRate),
    config.language,
    vadPath,
    String(config.vadSilenceMs),
    hotwordsFile,
    '2'
  ]
  const exe = portableWorkerExe()
  const python = exe ? null : resolveSherpaPython()
  const program = exe ?? python![0]
  const args = exe
    ? workerArgv
    : [...python!.slice(1), '-u', writeWorkerScript(), ...workerArgv]
  let stderrBuf = ''
  child = spawn(program, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  lineBuf = ''
  child.stdout!.on('data', (chunk: Buffer) => {
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
          logBus.debug('asr', 'speech_start')
          continue
        }
        if (msg.type === 'error') {
          logBus.warn('asr', msg.message ?? '')
          continue
        }
        if (msg.text?.trim()) {
          resultCallback?.(msg.text.trim(), msg.type === 'partial')
        }
      } catch { /* skip malformed */ }
    }
  })
  child.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    stderrBuf += text + '\n'
    if (text) logBus.warn('asr', text)
  })
  child.on('exit', (code) => {
    if (startup) {
      startup.reject(new Error(`ASR 子进程启动失败 (code=${code}): ${stderrBuf.slice(-300).trim() || '无错误输出'}`))
      startup = null
    }
    if (running) {
      logBus.warn('asr', `ASR 子进程退出 code=${code}`)
      running = false
      child = null
    }
  })
  running = true
  logBus.info('asr', `ASR 已启动 (engine=sherpa, backend=${exe ? 'ASRWorker2.exe' : program}, model=${config.modelPath}, sampleRate=${config.sampleRate})`)
  try {
    await new Promise<void>((resolve, reject) => {
      startup = { resolve, reject }
      setTimeout(() => {
        if (startup) {
          startup = null
          reject(new Error('ASR 模型加载超时（30 秒）'))
        }
      }, 30000)
    })
  } catch (err) {
    running = false
    const c = child
    child = null
    c?.kill()
    throw err
  }
}

export function stopASR(): void {
  if (startup) {
    startup.reject(new Error('ASR 已停止'))
    startup = null
  }
  if (!running) return
  running = false
  if (child) {
    try { child.stdin!.end() } catch { /* ignore */ }
    setTimeout(() => {
      if (child && !child.killed) child.kill()
      child = null
    }, 2000)
  }
  logBus.info('asr', 'ASR 已停止')
}

export function feedAudio(pcm16: Buffer): void {
  if (!running || !child || child.killed) return
  try {
    child.stdin!.write(pcm16)
  } catch { /* ignore broken pipe */ }
}

export function isASRRunning(): boolean {
  return running
}

const engine: ASREngine = {
  start: () => startASR(),
  stop: () => stopASR(),
  feed: (pcm16) => feedAudio(pcm16),
  isRunning: () => isASRRunning(),
  setResultCallback: (cb) => setResultCallback(cb)
}

export default engine
