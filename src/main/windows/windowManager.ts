import { BrowserWindow, Menu, screen, shell, Tray, type BrowserWindowConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { IpcChannels } from '@shared/ipc-channels'
import type { MateStatePayload } from '@shared/mate'
import type { MateState, SavedRect, WindowState } from '@shared/uiState'
import { getUIState, setUIState } from '../services/uiStateStore'

function intersectsDisplay(rect: SavedRect): boolean {
  if (rect.x === undefined || rect.y === undefined) return false
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(rect.x! + rect.width, workArea.x + workArea.width) - Math.max(rect.x!, workArea.x)
    const overlapY =
      Math.min(rect.y! + rect.height, workArea.y + workArea.height) - Math.max(rect.y!, workArea.y)
    return overlapX >= 80 && overlapY >= 80
  })
}

function mainWindowBounds(saved?: WindowState): BrowserWindowConstructorOptions {
  if (!saved) return { width: 1200, height: 780 }
  const width = Number.isFinite(saved.width) ? Math.max(960, Math.min(saved.width, 10000)) : 1200
  const height = Number.isFinite(saved.height) ? Math.max(640, Math.min(saved.height, 10000)) : 780
  if (intersectsDisplay({ ...saved, width, height })) {
    return { x: saved.x, y: saved.y, width, height }
  }
  return { width, height }
}

function mateWindowBounds(saved?: MateState): BrowserWindowConstructorOptions {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const fallback = { width: 320, height: 420, x: width - 340, y: height - 440 }
  if (!saved || !intersectsDisplay(saved)) return fallback
  return {
    x: saved.x,
    y: saved.y,
    width: Number.isFinite(saved.width) ? Math.max(180, Math.min(saved.width, 1200)) : 320,
    height: Number.isFinite(saved.height) ? Math.max(240, Math.min(saved.height, 1600)) : 420,
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn()
    }, ms)
  }
}

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
      ...mainWindowBounds(getUIState().window),
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

    this.main.on('ready-to-show', () => {
      if (getUIState().window?.maximized) this.main?.maximize()
      this.main?.show()
    })
    const saveBounds = (): void => {
      if (!this.main || this.main.isDestroyed() || this.main.isMinimized()) return
      try {
        const maximized = this.main.isMaximized()
        const bounds = maximized ? this.main.getNormalBounds() : this.main.getBounds()
        setUIState({ window: { ...bounds, maximized } })
      } catch {
        // 窗口销毁或持久化失败不影响关闭流程
      }
    }
    const saveBoundsSoon = debounce(saveBounds, 300)
    this.main.on('resize', saveBoundsSoon)
    this.main.on('move', saveBoundsSoon)
    this.main.on('maximize', saveBounds)
    this.main.on('unmaximize', saveBounds)
    this.main.on('close', (event) => {
      saveBounds()
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

    this.mate = new BrowserWindow({
      ...mateWindowBounds(getUIState().mate),
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
    setUIState({ mate: { open: true } })
    const saveBounds = (): void => {
      if (!this.mate || this.mate.isDestroyed()) return
      try {
        const bounds = this.mate.getBounds()
        setUIState({ mate: { ...bounds, open: true } })
      } catch {
        // 窗口销毁或持久化失败不影响关闭流程
      }
    }
    const saveBoundsSoon = debounce(saveBounds, 300)
    this.mate.on('resize', saveBoundsSoon)
    this.mate.on('move', saveBoundsSoon)
    this.loadRoute(this.mate, 'mate')
    this.mate.on('closed', () => {
      setUIState({ mate: { open: false } })
      this.mate = null
    })
    return { success: true }
  }

  closeMateWindow(): { success: true } {
    if (this.mate && !this.mate.isDestroyed()) {
      this.mate.close()
    }
    this.mate = null
    setUIState({ mate: { open: false } })
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
