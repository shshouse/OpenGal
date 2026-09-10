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

async function pingGenie(port: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2_000)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/openapi.json`, {
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

export async function startTTSServer(): Promise<TTSServerStatus> {
  if (childProcess && childProcess.exitCode === null) {
    return getTTSServerStatus()
  }
  if (reusedPort !== null) {
    return getTTSServerStatus()
  }

  const config = readConfig()
  const provider = config.tts.provider ?? 'gpt-sovits'

  if (provider === 'genie') {
    return startGenieServer()
  }

  return startGptSovitsServer()
}

async function startGptSovitsServer(): Promise<TTSServerStatus> {
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
    activeProvider = 'gpt-sovits'
    return { running: true, port: configPort, message: '复用已有服务', provider: 'gpt-sovits' }
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
  activeProvider = 'gpt-sovits'

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

async function startGenieServer(): Promise<TTSServerStatus> {
  const genieRoot = getGenieTTSRoot()
  const serverScript = path.join(genieRoot, 'genie_server.py')
  // 优先用 Genie 自带 runtime，其次用 GPT-SoVITS 的
  const bundledPython = getGeniePythonExe()
  const sovitsPython = getPythonExe()
  const pythonExe = fs.existsSync(bundledPython) ? bundledPython : sovitsPython
  const scriptDir = path.dirname(serverScript)

  if (!fs.existsSync(genieRoot)) {
    throw new Error(`Genie-TTS 目录未找到: ${genieRoot}。请确认 resources/genie/ 存在。`)
  }
  if (!fs.existsSync(serverScript)) {
    throw new Error(`genie_server.py 未找到: ${serverScript}`)
  }
  if (!fs.existsSync(pythonExe)) {
    throw new Error(`Python 运行时未找到: ${pythonExe}。请安装 Genie runtime 或 GPT-SoVITS。`)
  }

  const configPort = parseTtsPort(readConfig().tts.baseURL)

  if (await pingGenie(configPort)) {
    reusedPort = configPort
    clearTtsPortShift()
    appendLog(`Port ${configPort} answered ping, reusing existing Genie-TTS`)
    logBus.info('tts-server', `端口 ${configPort} 已有 Genie-TTS 应答，直接复用`)
    activeProvider = 'genie'
    return { running: true, port: configPort, message: '复用已有服务', provider: 'genie' }
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
    throw new Error(`端口 ${configPort} 至 ${configPort + 19} 全部被占用，无法启动 Genie-TTS`)
  }
  if (port === configPort) {
    clearTtsPortShift()
  } else {
    setTtsPortShift(configPort, port)
    appendLog(`Port ${configPort} occupied, using ${port} instead`)
    logBus.warn('tts-server', `端口 ${configPort} 被其他程序占用，改用 ${port}`)
  }

  appendLog(`Starting Genie-TTS server on port ${port}...`)
  appendLog(`python: ${pythonExe}`)
  appendLog(`script: ${serverScript}`)
  logBus.info('tts-server', `启动 Genie-TTS 服务 port=${port}`, `script=${serverScript}`)

  childProcess = spawn(pythonExe, [serverScript, '--port', String(port)], {
    cwd: scriptDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      GENIE_DATA_DIR: path.join(genieRoot, 'GenieData'),
    },
    windowsHide: true,
  })
  activeProvider = 'genie'

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    appendLog(`[stdout] ${chunk.toString('utf-8').trimEnd()}`)
  })
  childProcess.stderr?.on('data', (chunk: Buffer) => {
    appendLog(`[stderr] ${chunk.toString('utf-8').trimEnd()}`)
  })
  childProcess.on('exit', (code, signal) => {
    appendLog(`Process exited code=${code} signal=${signal}`)
    if (code === 0 || signal === 'SIGTERM') {
      logBus.info('tts-server', `Genie-TTS 进程退出 code=${code} signal=${signal}`)
    } else {
      logBus.warn('tts-server', `Genie-TTS 进程异常退出 code=${code} signal=${signal}`, lastLog.slice(-2000))
    }
  })
  childProcess.on('error', (err) => {
    appendLog(`Process error: ${err.message}`)
    logBus.error('tts-server', `Genie-TTS 进程错误: ${err.message}`)
  })

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (!childProcess || childProcess.exitCode !== null) {
      throw new Error(`Genie-TTS server exited early. Log tail:\n${lastLog.slice(-1000)}`)
    }
    if (await pingGenie(port)) {
      appendLog('Genie-TTS is ready')
      logBus.info('tts-server', `Genie-TTS 服务就绪 port=${port} pid=${childProcess?.pid}`)
      return getTTSServerStatus()
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  logBus.error('tts-server', 'Genie-TTS 服务在 60 秒内未就绪', lastLog.slice(-2000))
  throw new Error('Genie-TTS server did not become ready within 60 seconds')
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
