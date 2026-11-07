// 屏幕观察：一条常驻的桌面视频流，按需读变化分或抓一小段拼成图。
//
// 用隐藏窗口持有视频流，而不是反复调 desktopCapturer.getSources：后者每次都要新建
// 一次采集会话，实测单次 575ms，按秒轮询会吃掉一个核。常驻流上取一帧只要 1.3ms。

import { BrowserWindow, desktopCapturer } from 'electron'
import { join } from 'node:path'
import type { SampledFrame, ScreenPulse } from '@shared/screen'
import { logBus } from './logBus'
import { getErrorMessage } from '@shared/errors'

const PULSE_MS = 3_000
/** 隐藏窗口里的一次调用最多等这么久，超时就当采集卡死 */
const CALL_TIMEOUT_MS = 40_000

let win: BrowserWindow | null = null
let booting: Promise<BrowserWindow> | null = null
let enabled = false
let timer: ReturnType<typeof setInterval> | null = null
let pulse: ScreenPulse | null = null
let polling = false

function pageSource(): { url?: string; file?: string } {
  // 开发期由 electron-vite 注入渲染层地址；打包后没有这个变量，直接读构建产物
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return { url: `${devUrl}/capture.html` }
  return { file: join(__dirname, '../renderer/capture.html') }
}

async function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(new Error(`${label}超时`)), ms)
      }),
    ])
  } finally {
    if (timerId) clearTimeout(timerId)
  }
}

async function boot(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win
  if (booting) return booting
  booting = (async () => {
    const created = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { backgroundThrottling: false },
    })
    created.webContents.on('render-process-gone', () => {
      if (win === created) {
        win = null
        pulse = null
      }
    })
    const source = pageSource()
    if (source.url) await created.loadURL(source.url)
    else await created.loadFile(source.file!)

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    })
    const primary = sources.find((item) => item.display_id !== '') ?? sources[0]
    if (!primary) throw new Error('没有可用的显示器')

    await withTimeout(
      created.webContents.executeJavaScript(`window.__screenStart(${JSON.stringify(primary.id)})`),
      CALL_TIMEOUT_MS,
      '启动屏幕采集',
    )
    win = created
    return created
  })()
  try {
    return await booting
  } finally {
    booting = null
  }
}

async function sampleOnce(): Promise<void> {
  if (polling || !win || win.isDestroyed()) return
  polling = true
  try {
    const next = (await win.webContents.executeJavaScript('window.__screenPulse()')) as ScreenPulse
    pulse = next
  } catch (err) {
    pulse = null
    logBus.warn('screen', `读取屏幕状态失败: ${getErrorMessage(err)}`)
    destroyWindow()
  } finally {
    polling = false
  }
}

/** 开启后立刻建流并开始采样；关闭时整条流一起销毁，不留后台采集。 */
export function setScreenWatchEnabled(next: boolean): void {
  if (next === enabled) return
  enabled = next
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (!next) {
    destroyWindow()
    pulse = null
    return
  }
  void boot()
    .then(() => sampleOnce())
    .catch((err) => logBus.warn('screen', `屏幕观察未能启动: ${getErrorMessage(err)}`))
  timer = setInterval(() => {
    void sampleOnce()
  }, PULSE_MS)
}

export function getScreenPulse(): ScreenPulse | null {
  return enabled ? pulse : null
}

export function isScreenWatchEnabled(): boolean {
  return enabled
}

/** 看一眼：抓 ms 毫秒，返回拼好的图和每格的时间点。 */
export async function lookAtScreen(
  ms: number,
): Promise<{ png: string; frames: SampledFrame[] } | null> {
  if (!enabled) return null
  try {
    const target = await boot()
    return (await withTimeout(
      target.webContents.executeJavaScript(`window.__screenSheet(${ms})`),
      CALL_TIMEOUT_MS,
      '查看屏幕',
    )) as { png: string; frames: SampledFrame[] }
  } catch (err) {
    logBus.warn('screen', `查看屏幕失败: ${getErrorMessage(err)}`)
    destroyWindow()
    return null
  }
}

function destroyWindow(): void {
  if (!win || win.isDestroyed()) {
    win = null
    return
  }
  const target = win
  win = null
  try {
    target.destroy()
  } catch {
    /* 已经没了 */
  }
}

export function disposeScreenWatch(): void {
  enabled = false
  if (timer) clearInterval(timer)
  timer = null
  pulse = null
  destroyWindow()
}
