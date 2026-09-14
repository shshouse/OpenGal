import { spawn, ChildProcess } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { getModRoot, getGenieTTSRoot, getGeniePythonExe } from './paths'
import { readConfig } from './configStore'
import { logBus } from './logBus'
import { clearTtsPortShift, getTtsPortShift, parseTtsPort, setTtsPortShift } from './ttsPort'

const GPTSOVITS_DIR = path.join('TTS', 'GPT-SoVITS-v2pro-20250604')

export interface TTSServerStatus {
  running: boolean
  pid?: number
  message?: string
  port?: number
  provider?: 'gpt-sovits' | 'genie'
}

let childProcess: ChildProcess | null = null
let lastLog = ''
let reusedPort: number | null = null
let activeProvider: 'gpt-sovits' | 'genie' | null = null

function appendLog(line: string): void {
  const entry = `[${new Date().toISOString()}] ${line}\n`
  lastLog = (lastLog + entry).slice(-16_000)
}

async function pingEndpoint(port: number, urlPath: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
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

export function getTTSServerStatus(): TTSServerStatus {
  const config = readConfig()
  const configPort = parseTtsPort(config.tts.baseURL)
  const port = getTtsPortShift()?.to ?? configPort
  const provider = config.tts.provider ?? 'gpt-sovits'
  if (reusedPort !== null) {
    return { running: true, port: reusedPort, message: '复用已有服务', provider: activeProvider ?? provider }
  }
  if (!childProcess || childProcess.exitCode !== null) {
    return { running: false, port, message: lastLog.slice(-500), provider: activeProvider ?? provider }
  }
  return { running: true, pid: childProcess.pid, port, provider: activeProvider ?? provider }
}

export function getTTSServerLog(): string {
  return lastLog
}

interface ServerSpec {
  label: string
  provider: 'gpt-sovits' | 'genie'
  pythonExe: string
  script: string
  args: (port: number) => string[]
  cwd: string
  extraEnv?: Record<string, string>
  pingPath: string
  pingTimeoutMs: number
  readyTimeoutMs: number
}

function sovitsSpec(): ServerSpec {
  const root = path.join(getModRoot(), GPTSOVITS_DIR)
  const pythonExe = path.join(root, 'runtime', 'python.exe')
  const script = path.join(root, 'api_v2.py')
  if (!fs.existsSync(root)) throw new Error(`GPT-SoVITS folder not found: ${root}`)
  if (!fs.existsSync(pythonExe)) throw new Error(`Bundled Python runtime not found: ${pythonExe}`)
  if (!fs.existsSync(script)) throw new Error(`api_v2.py not found: ${script}`)
  return {
    label: 'GPT-SoVITS',
    provider: 'gpt-sovits',
    pythonExe,
    script,
    args: (port) => [script, '-a', '127.0.0.1', '-p', String(port)],
    cwd: root,
    pingPath: '/control?command=ping',
    pingTimeoutMs: 1_000,
    readyTimeoutMs: 90_000,
  }
}

function genieSpec(): ServerSpec {
  const genieRoot = getGenieTTSRoot()
  const script = path.join(genieRoot, 'genie_server.py')
  const bundledPython = getGeniePythonExe()
  const sovitsPython = path.join(getModRoot(), GPTSOVITS_DIR, 'runtime', 'python.exe')
  const pythonExe = fs.existsSync(bundledPython) ? bundledPython : sovitsPython
  if (!fs.existsSync(genieRoot)) {
    throw new Error(`Genie-TTS 目录未找到: ${genieRoot}。请确认 resources/tts/genie/ 存在。`)
  }
  if (!fs.existsSync(script)) throw new Error(`genie_server.py 未找到: ${script}`)
  if (!fs.existsSync(pythonExe)) {
    throw new Error(`Python 运行时未找到: ${pythonExe}。请安装 Genie runtime 或 GPT-SoVITS。`)
  }
  return {
    label: 'Genie-TTS',
    provider: 'genie',
    pythonExe,
    script,
    args: (port) => [script, '--port', String(port)],
    cwd: path.dirname(script),
    extraEnv: {
      GENIE_DATA_DIR: path.join(genieRoot, 'GenieData'),
      NLTK_DATA: path.join(genieRoot, 'runtime', 'nltk_data'),
    },
    pingPath: '/openapi.json',
    pingTimeoutMs: 2_000,
    readyTimeoutMs: 60_000,
  }
}

async function launchServer(spec: ServerSpec): Promise<TTSServerStatus> {
  const configPort = parseTtsPort(readConfig().tts.baseURL)

  if (await pingEndpoint(configPort, spec.pingPath, spec.pingTimeoutMs)) {
    reusedPort = configPort
    clearTtsPortShift()
    appendLog(`Port ${configPort} answered ping, reusing existing ${spec.label}`)
    logBus.info('tts-server', `端口 ${configPort} 已有 ${spec.label} 应答，直接复用`)
    activeProvider = spec.provider
    return { running: true, port: configPort, message: '复用已有服务', provider: spec.provider }
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
    throw new Error(`端口 ${configPort} 至 ${configPort + 19} 全部被占用，无法启动 ${spec.label}`)
  }
  if (port === configPort) {
    clearTtsPortShift()
  } else {
    setTtsPortShift(configPort, port)
    appendLog(`Port ${configPort} occupied, using ${port} instead`)
    logBus.warn('tts-server', `端口 ${configPort} 被其他程序占用，改用 ${port}`)
  }

  appendLog(`Starting ${spec.label} on port ${port}...`)
  appendLog(`python: ${spec.pythonExe}`)
  appendLog(`script: ${spec.script}`)
  logBus.info('tts-server', `启动 ${spec.label} 服务 port=${port}`, `cwd=${spec.cwd}\npython=${spec.pythonExe}`)

  childProcess = spawn(spec.pythonExe, spec.args(port), {
    cwd: spec.cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...spec.extraEnv },
    windowsHide: true
  })
  activeProvider = spec.provider

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    appendLog(`[stdout] ${chunk.toString('utf-8').trimEnd()}`)
  })
  childProcess.stderr?.on('data', (chunk: Buffer) => {
    appendLog(`[stderr] ${chunk.toString('utf-8').trimEnd()}`)
  })
  childProcess.on('exit', (code, signal) => {
    appendLog(`Process exited code=${code} signal=${signal}`)
    if (code === 0 || signal === 'SIGTERM') {
      logBus.info('tts-server', `${spec.label} 进程退出 code=${code} signal=${signal}`)
    } else {
      logBus.warn('tts-server', `${spec.label} 进程异常退出 code=${code} signal=${signal}`, lastLog.slice(-2000))
    }
  })
  childProcess.on('error', (err) => {
    appendLog(`Process error: ${err.message}`)
    logBus.error('tts-server', `${spec.label} 进程错误: ${err.message}`)
  })

  const deadline = Date.now() + spec.readyTimeoutMs
  while (Date.now() < deadline) {
    if (!childProcess || childProcess.exitCode !== null) {
      throw new Error(`${spec.label} server exited early. Log tail:\n${lastLog.slice(-1000)}`)
    }
    if (await pingEndpoint(port, spec.pingPath, spec.pingTimeoutMs)) {
      appendLog(`${spec.label} is ready`)
      logBus.info('tts-server', `${spec.label} 服务就绪 port=${port} pid=${childProcess?.pid}`)
      return getTTSServerStatus()
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  logBus.error('tts-server', `${spec.label} 服务在 ${spec.readyTimeoutMs / 1000} 秒内未就绪`, lastLog.slice(-2000))
  throw new Error(`${spec.label} server did not become ready within ${spec.readyTimeoutMs / 1000} seconds`)
}

export async function startTTSServer(): Promise<TTSServerStatus> {
  if (childProcess && childProcess.exitCode === null) {
    return getTTSServerStatus()
  }
  if (reusedPort !== null) {
    return getTTSServerStatus()
  }
  const provider = readConfig().tts.provider ?? 'gpt-sovits'
  return launchServer(provider === 'genie' ? genieSpec() : sovitsSpec())
}

export async function startGptSovitsServer(): Promise<TTSServerStatus> {
  return launchServer(sovitsSpec())
}

export async function stopTTSServer(): Promise<TTSServerStatus> {
  reusedPort = null
  clearTtsPortShift()
  if (!childProcess || childProcess.exitCode !== null) {
    return { running: false }
  }
  appendLog('Stopping TTS server...')
  logBus.info('tts-server', `停止 ${activeProvider ?? 'TTS'} 服务`)
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
