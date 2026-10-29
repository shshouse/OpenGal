import { BrowserWindow, Menu, screen, shell, Tray } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { IpcChannels } from '@shared/ipc-channels'

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
  private pet: BrowserWindow | null = null
  private petDragCursor: { x: number; y: number } | null = null
  private petDragPos: number[] | null = null
  private excludeSelf = true

  constructor(private readonly deps: WindowDeps) {}

  setSelfExclusion(enabled: boolean): void {
    this.excludeSelf = enabled
    if (this.pet && !this.pet.isDestroyed()) this.pet.setContentProtection(enabled)
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
      shell.openExternal(details.url)
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

  openPetWindow(): { success: true } {
    if (this.pet && !this.pet.isDestroyed()) {
      this.pet.focus()
      return { success: true }
    }

    const primary = screen.getPrimaryDisplay()
    const { width, height } = primary.workAreaSize

    this.pet = new BrowserWindow({
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
    this.pet.setAlwaysOnTop(true, 'screen-saver')
    this.pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.pet.setContentProtection(this.excludeSelf)
    this.loadRoute(this.pet, 'pet')
    this.pet.on('closed', () => {
      this.pet = null
    })
    return { success: true }
  }

  closePetWindow(): { success: true } {
    if (this.pet && !this.pet.isDestroyed()) {
      this.pet.close()
    }
    this.pet = null
    return { success: true }
  }

  dragPetStart(): void {
    if (!this.pet || this.pet.isDestroyed()) return
    this.petDragCursor = screen.getCursorScreenPoint()
    this.petDragPos = this.pet.getPosition()
  }

  dragPetMove(): void {
    if (!this.pet || this.pet.isDestroyed() || !this.petDragCursor || !this.petDragPos) return
    const now = screen.getCursorScreenPoint()
    this.pet.setPosition(
      this.petDragPos[0] + now.x - this.petDragCursor.x,
      this.petDragPos[1] + now.y - this.petDragCursor.y
    )
  }

  sendPetBubble(text: string): void {
    if (this.pet && !this.pet.isDestroyed()) {
      this.pet.webContents.send(IpcChannels.pet.bubble, text)
    }
  }

  sendPetPerformance(payload: { emotion?: string; motion?: string; characterId?: string; speaking?: boolean }): void {
    if (this.pet && !this.pet.isDestroyed()) {
      this.pet.webContents.send(IpcChannels.pet.performance, payload)
    }
  }

  sendPetRuntime(payload: { runningCharacters: Record<string, boolean>; activeCharacterId: string | null }): void {
    if (this.pet && !this.pet.isDestroyed()) {
      this.pet.webContents.send(IpcChannels.pet.runtime, payload)
    }
  }

  sendMainAvatar(dataUrl: string): void {
    if (this.main && !this.main.isDestroyed()) {
      this.main.webContents.send(IpcChannels.pet.avatar, dataUrl)
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
