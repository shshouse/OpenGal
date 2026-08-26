import { spawn, type ChildProcess } from 'node:child_process'
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

export function setResultCallback(cb: ASRResultCallback | null): void {
  resultCallback = cb
}

export async function startASR(): Promise<void> {
  if (running) return
  const config = readConfig().asr
  if (!config.modelPath) {
    throw new Error('ASR modelPath 未配置。请在设置中指定 Vosk 模型目录路径。')
  }
  // 相对路径按 mods 根解析（STT 模型随 mods 便携存放）；找不到再按应用根兜底
  const modelPath = path.isAbsolute(config.modelPath)
    ? config.modelPath
    : [path.join(getModRoot(), config.modelPath), path.join(app.getAppPath(), config.modelPath)].find(
        (p) => fs.existsSync(p)
      ) ?? path.join(getModRoot(), config.modelPath)
  const script = VOSK_WORKER_SCRIPT
  child = spawn('python', ['-u', '-c', script, modelPath, String(config.sampleRate)], {
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
        const msg = JSON.parse(line) as { type: 'partial' | 'final'; text: string }
        if (msg.text?.trim()) {
          resultCallback?.(msg.text.trim(), msg.type === 'partial')
        }
      } catch { /* skip malformed */ }
    }
  })
  child.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) logBus.warn('asr', text)
  })
  child.on('exit', (code) => {
    if (running) {
      logBus.warn('asr', `ASR 子进程退出 code=${code}`)
      running = false
      child = null
    }
  })
  running = true
  logBus.info('asr', `ASR 已启动 (model=${config.modelPath}, sampleRate=${config.sampleRate})`)
}

export function stopASR(): void {
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
