import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logBus } from '../logBus'
import { readConfig } from '../configStore'
import { getModRoot } from '../paths'

export type ASRResultCallback = (text: string, partial: boolean) => void

let child: ChildProcess | null = null
let running = false
let resultCallback: ASRResultCallback | null = null
let lineBuf = ''
let startup: { resolve: () => void; reject: (e: Error) => void } | null = null

export function setResultCallback(cb: ASRResultCallback | null): void {
  resultCallback = cb
}

function resolveVoskPython(): string[] {
  const candidates: string[][] = [['python'], ['py', '-3.12'], ['py', '-3.11'], ['py', '-3.10']]
  for (const cmd of candidates) {
    try {
      execFileSync(cmd[0], [...cmd.slice(1), '-c', 'import vosk'], { stdio: 'ignore', windowsHide: true })
      return cmd
    } catch { /* try next */ }
  }
  throw new Error('未找到安装了 vosk 的 Python。请执行: pip install vosk')
}

function portableWorkerExe(): string | null {
  const exe = path.join(getModRoot(), 'STT', 'ASRWorker', 'ASRWorker.exe')
  return fs.existsSync(exe) ? exe : null
}

export async function startASR(): Promise<void> {
  if (running) return
  const config = readConfig().asr
  if (!config.modelPath) {
    throw new Error('ASR modelPath 未配置。请在设置中指定 Vosk 模型目录路径。')
  }
  const modelPath = path.isAbsolute(config.modelPath)
    ? config.modelPath
    : [path.join(getModRoot(), config.modelPath), path.join(app.getAppPath(), config.modelPath)].find(
        (p) => fs.existsSync(p)
      ) ?? path.join(getModRoot(), config.modelPath)
  const exe = portableWorkerExe()
  const python = exe ? null : resolveVoskPython()
  const program = exe ?? python![0]
  const args = exe
    ? [modelPath, String(config.sampleRate)]
    : [...python!.slice(1), '-u', '-c', VOSK_WORKER_SCRIPT, modelPath, String(config.sampleRate)]
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
        const msg = JSON.parse(line) as { type: 'ready' | 'partial' | 'final'; text: string }
        if (msg.type === 'ready') {
          startup?.resolve()
          startup = null
          continue
        }
        if (msg.text?.trim()) {
          const text = /^zh/.test(config.language) ? msg.text.replace(/\s+/g, '') : msg.text
          resultCallback?.(text.trim(), msg.type === 'partial')
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
  logBus.info('asr', `ASR 已启动 (backend=${exe ? 'ASRWorker.exe' : program}, model=${config.modelPath}, sampleRate=${config.sampleRate})`)
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

const VOSK_WORKER_SCRIPT = `
import sys, json
from vosk import Model, KaldiRecognizer, SetLogLevel

SetLogLevel(-1)
model_path = sys.argv[1]
sample_rate = int(sys.argv[2])

model = Model(model_path=model_path)
rec = KaldiRecognizer(model, sample_rate)
rec.SetWords(True)
print(json.dumps({"type":"ready","text":""}), flush=True)

CHUNK = 4096
while True:
    data = sys.stdin.buffer.read(CHUNK)
    if not data:
        break
    if rec.AcceptWaveform(data):
        r = json.loads(rec.Result())
        if r.get("text"):
            print(json.dumps({"type":"final","text":r["text"]}), flush=True)
    else:
        r = json.loads(rec.PartialResult())
        if r.get("partial"):
            print(json.dumps({"type":"partial","text":r["partial"]}), flush=True)

r = json.loads(rec.FinalResult())
if r.get("text"):
    print(json.dumps({"type":"final","text":r["text"]}), flush=True)
`
