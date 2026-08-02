import { BrowserWindow, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'

interface WindowDeps {
  preloadPath: string
  rendererDevServerUrl?: string
  rendererHtmlPath: string
}

export class WindowManager {
  private main: BrowserWindow | null = null
  private pet: BrowserWindow | null = null

  constructor(private readonly deps: WindowDeps) {}

  createMainWindow(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) {
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
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    this.main.on('ready-to-show', () => this.main?.show())
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
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    this.pet.setAlwaysOnTop(true, 'screen-saver')
    this.pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
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

  sendPetBubble(text: string): { success: true } {
    if (this.pet && !this.pet.isDestroyed()) {
      this.pet.webContents.send('pet:bubble', text)
    }
    return { success: true }
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
    if (is.dev) window.webContents.openDevTools({ mode: 'detach' })
  }
}

export function createWindowManager(rendererHtmlRelative: string): WindowManager {
  const preloadPath = join(__dirname, '../preload/index.js')
  const rendererHtmlPath = join(__dirname, rendererHtmlRelative)
  const rendererDevServerUrl = process.env.ELECTRON_RENDERER_URL
  return new WindowManager({
    preloadPath,
    rendererHtmlPath,
    rendererDevServerUrl
  })
}
