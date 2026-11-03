import { BrowserWindow, Menu, screen, shell, Tray } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { IpcChannels } from '@shared/ipc-channels'
import type { MateStatePayload } from '@shared/mate'

const windowIcon = is.dev
  ? join(process.cwd(), 'public/Logo/icon.png')
  : join(process.resourcesPath, 'icon.png')

interface WindowDeps {
  preloadPath: string
  rendererDevServerUrl?: string
  rendererHtmlPath: string
  isQuitting: () => boolean
}

export class WindowManager {
  private main: BrowserWindow | null = null
  private mate: BrowserWindow | null = null
  private mateDragCursor: { x: number; y: number } | null = null
  private mateDragPos: number[] | null = null
  private excludeSelf = true

  constructor(private readonly deps: WindowDeps) {}

  setSelfExclusion(enabled: boolean): void {
    this.excludeSelf = enabled
    if (this.mate && !this.mate.isDestroyed()) this.mate.setContentProtection(enabled)
  }

  createMainWindow(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) {
      if (this.main.isMinimized()) this.main.restore()
      this.main.show()
      this.main.focus()
      return this.main
    }

    this.main = new BrowserWindow({
      width: 1200,
      height: 780,
      minWidth: 960,
      minHeight: 640,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      autoHideMenuBar: true,
      backgroundColor: '#0b0b12',
      icon: windowIcon,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    this.main.on('ready-to-show', () => this.main?.show())
    this.main.on('close', (event) => {
      if (this.deps.isQuitting()) return
      event.preventDefault()
      this.main?.hide()
    })
    this.main.webContents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url)
      return { action: 'deny' }
    })
    this.main.on('closed', () => {
      this.main = null
    })

    this.loadRoute(this.main, '')
    return this.main
  }

  createTray(onQuit: () => void): Tray {
    const tray = new Tray(windowIcon)
    tray.setToolTip('OpenGal')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 OpenGal', click: () => this.createMainWindow() },
      { type: 'separator' },
      { label: '退出', click: onQuit }
    ]))
    tray.on('click', () => this.createMainWindow())
    return tray
  }

  openMateWindow(): { success: true } {
    if (this.mate && !this.mate.isDestroyed()) {
      this.mate.focus()
      return { success: true }
    }

    const primary = screen.getPrimaryDisplay()
    const { width, height } = primary.workAreaSize

    this.mate = new BrowserWindow({
      width: 320,
      height: 420,
      x: width - 340,
      y: height - 440,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      icon: windowIcon,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.mate.setAlwaysOnTop(true, 'screen-saver')
    this.mate.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.mate.setContentProtection(this.excludeSelf)
    this.loadRoute(this.mate, 'mate')
    this.mate.on('closed', () => {
      this.mate = null
    })
    return { success: true }
  }

  closeMateWindow(): { success: true } {
    if (this.mate && !this.mate.isDestroyed()) {
      this.mate.close()
    }
    this.mate = null
    return { success: true }
  }

  dragMateStart(): void {
    if (!this.mate || this.mate.isDestroyed()) return
    this.mateDragCursor = screen.getCursorScreenPoint()
    this.mateDragPos = this.mate.getPosition()
  }

  dragMateMove(): void {
    if (!this.mate || this.mate.isDestroyed() || !this.mateDragCursor || !this.mateDragPos) return
    const [originX, originY] = this.mateDragPos
    if (originX === undefined || originY === undefined) return
    const now = screen.getCursorScreenPoint()
    this.mate.setPosition(
      originX + now.x - this.mateDragCursor.x,
      originY + now.y - this.mateDragCursor.y
    )
  }

  /** avatar 反向回主窗口（相伴窗口截图给主窗口），其余状态下发给相伴窗口。 */
  dispatchMateState(payload: MateStatePayload): void {
    const target = payload.type === 'avatar' ? this.main : this.mate
    if (target && !target.isDestroyed()) {
      target.webContents.send(IpcChannels.mate.update, payload)
    }
  }

  minimizeMain(): void {
    this.main?.minimize()
  }

  maximizeMain(): void {
    if (this.main?.isMaximized()) {
      this.main.unmaximize()
    } else {
      this.main?.maximize()
    }
  }

  closeMain(): void {
    this.main?.close()
  }

  isMainMaximized(): boolean {
    return this.main?.isMaximized() ?? false
  }

  private loadRoute(window: BrowserWindow, hash: string): void {
    if (is.dev && this.deps.rendererDevServerUrl) {
      void window.loadURL(`${this.deps.rendererDevServerUrl}#${hash}`)
    } else {
      void window.loadFile(this.deps.rendererHtmlPath, { hash })
    }
  }
}

export function createWindowManager(
  rendererHtmlRelative: string,
  isQuitting: () => boolean
): WindowManager {
  const preloadPath = join(__dirname, '../preload/index.js')
  const rendererHtmlPath = join(__dirname, rendererHtmlRelative)
  const rendererDevServerUrl = process.env.ELECTRON_RENDERER_URL
  return new WindowManager({
    preloadPath,
    rendererHtmlPath,
    rendererDevServerUrl,
    isQuitting
  })
}
