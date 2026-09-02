import { spawn, ChildProcess } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { getModRoot } from './paths'
import { readConfig } from './configStore'
import { logBus } from './logBus'
import { clearTtsPortShift, getTtsPortShift, parseTtsPort, setTtsPortShift } from './ttsPort'

const GPTSOVITS_DIR = path.join('TTS', 'GPT-SoVITS-v2pro-20250604')

export interface TTSServerStatus {
  running: boolean
  pid?: number
  message?: string
  port?: number
}

let childProcess: ChildProcess | null = null
let lastLog = ''
let reusedPort: number | null = null

function appendLog(line: string): void {
  const entry = `[${new Date().toISOString()}] ${line}\n`
  lastLog = (lastLog + entry).slice(-16_000)
}

async function pingSovits(port: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1_000)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/control?command=ping`, {
      signal: controller.signal
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

function getSoVITSRoot(): string {
  return path.join(getModRoot(), GPTSOVITS_DIR)
}

function getPythonExe(): string {
  return path.join(getSoVITSRoot(), 'runtime', 'python.exe')
}

export function getTTSServerStatus(): TTSServerStatus {
  const configPort = parseTtsPort(readConfig().tts.baseURL)
  const port = getTtsPortShift()?.to ?? configPort
  if (reusedPort !== null) {
    return { running: true, port: reusedPort, message: '复用已有服务' }
  }
  if (!childProcess || childProcess.exitCode !== null) {
    return { running: false, port, message: lastLog.slice(-500) }
  }
  return { running: true, pid: childProcess.pid, port }
}

export function getTTSServerLog(): string {
  return lastLog
}

export async function startTTSServer(): Promise<TTSServerStatus> {
  if (childProcess && childProcess.exitCode === null) {
    return getTTSServerStatus()
  }
  if (reusedPort !== null) {
    return getTTSServerStatus()
  }

  const root = getSoVITSRoot()
  const pythonExe = getPythonExe()
  const apiScript = path.join(root, 'api_v2.py')

  if (!fs.existsSync(root)) {
    throw new Error(`GPT-SoVITS folder not found: ${root}`)
  }
  if (!fs.existsSync(pythonExe)) {
    throw new Error(`Bundled Python runtime not found: ${pythonExe}`)
  }
  if (!fs.existsSync(apiScript)) {
    throw new Error(`api_v2.py not found: ${apiScript}`)
  }

  const configPort = parseTtsPort(readConfig().tts.baseURL)

  if (await pingSovits(configPort)) {
    reusedPort = configPort
    clearTtsPortShift()
    appendLog(`Port ${configPort} answered ping, reusing existing GPT-SoVITS`)
    logBus.info('tts-server', `端口 ${configPort} 已有 GPT-SoVITS 应答，直接复用`)
    return { running: true, port: configPort, message: '复用已有服务' }
  }
  reusedPort = null
  let port: number | null = null
  for (let candidate = configPort; candidate < configPort + 20; candidate++) {
    if (await isPortFree(candidate)) {
      port = candidate
      break
    }
  }
  if (port === null) {
    throw new Error(`端口 ${configPort} 至 ${configPort + 19} 全部被占用，无法启动 GPT-SoVITS`)
  }
  if (port === configPort) {
    clearTtsPortShift()
  } else {
    setTtsPortShift(configPort, port)
    appendLog(`Port ${configPort} occupied, using ${port} instead`)
    logBus.warn('tts-server', `端口 ${configPort} 被其他程序占用，改用 ${port}`)
  }

  appendLog(`Starting GPT-SoVITS api_v2.py on port ${port}...`)
  appendLog(`python: ${pythonExe}`)
  appendLog(`cwd: ${root}`)
  logBus.info('tts-server', `启动 GPT-SoVITS 服务 port=${port}`, `cwd=${root}\npython=${pythonExe}`)

  childProcess = spawn(pythonExe, [apiScript, '-a', '127.0.0.1', '-p', String(port)], {
    cwd: root,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true
  })

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    appendLog(`[stdout] ${chunk.toString('utf-8').trimEnd()}`)
  })
  childProcess.stderr?.on('data', (chunk: Buffer) => {
    appendLog(`[stderr] ${chunk.toString('utf-8').trimEnd()}`)
  })
  childProcess.on('exit', (code, signal) => {
    appendLog(`Process exited code=${code} signal=${signal}`)
    if (code === 0 || signal === 'SIGTERM') {
      logBus.info('tts-server', `进程退出 code=${code} signal=${signal}`)
    } else {
      logBus.warn('tts-server', `进程异常退出 code=${code} signal=${signal}`, lastLog.slice(-2000))
    }
  })
  childProcess.on('error', (err) => {
    appendLog(`Process error: ${err.message}`)
    logBus.error('tts-server', `进程错误: ${err.message}`)
  })
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (!childProcess || childProcess.exitCode !== null) {
      throw new Error(`TTS server exited early. Log tail:\n${lastLog.slice(-1000)}`)
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1000)
      const res = await fetch(`http://127.0.0.1:${port}/control?command=ping`, {
        signal: controller.signal
      }).catch(() => null)
      clearTimeout(timer)
      if (res) {
        appendLog('Server is ready')
        logBus.info('tts-server', `GPT-SoVITS 服务就绪 port=${port} pid=${childProcess?.pid}`)
        return getTTSServerStatus()
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  logBus.error('tts-server', '服务在 90 秒内未就绪', lastLog.slice(-2000))
  throw new Error('TTS server did not become ready within 90 seconds')
}

export async function stopTTSServer(): Promise<TTSServerStatus> {
  reusedPort = null
  clearTtsPortShift()
  if (!childProcess || childProcess.exitCode !== null) {
    return { running: false }
  }
  appendLog('Stopping GPT-SoVITS server...')
  logBus.info('tts-server', '停止 GPT-SoVITS 服务')
  const proc = childProcess
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true })
    } else {
      proc.kill('SIGTERM')
    }
  } catch (err) {
    appendLog(`Stop error: ${(err as Error).message}`)
  }
  childProcess = null
  return { running: false }
}
export function registerTTSServerCleanup(): void {
  const cleanup = (): void => {
    if (childProcess && childProcess.exitCode === null && childProcess.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(childProcess.pid), '/f', '/t'], { windowsHide: true })
        } else {
          childProcess.kill('SIGTERM')
        }
      } catch {}
    }
  }
  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}
