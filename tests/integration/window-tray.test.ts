import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowManager } from '../../src/main/windows/windowManager'

interface CloseEventDouble {
  defaultPrevented: boolean
  preventDefault: () => void
}

interface WindowDouble {
  destroyed: boolean
  visible: boolean
  focused: boolean
  minimized: boolean
  lastCloseEvent: CloseEventDouble | null
  close: () => void
}

interface TrayDouble {
  click: () => void
  contextMenu: { template: Array<{ click?: () => void }> } | null
}

const state = vi.hoisted(() => ({
  windows: [] as WindowDouble[],
  trays: [] as TrayDouble[],
  trayIconPaths: [] as string[],
}))

vi.mock('electron', () => {
  class BrowserWindow {
    static instances: BrowserWindow[] = []
    destroyed = false
    visible = false
    focused = false
    minimized = false
    maximized = false
    lastCloseEvent: CloseEventDouble | null = null
    private handlers = new Map<string, Array<(event: CloseEventDouble) => void>>()
    webContents = { setWindowOpenHandler: () => {}, send: () => {} }

    constructor() {
      BrowserWindow.instances.push(this)
      state.windows.push(this)
    }

    on(event: string, listener: (event: CloseEventDouble) => void): this {
      const listeners = this.handlers.get(event) ?? []
      listeners.push(listener)
      this.handlers.set(event, listeners)
      return this
    }

    emit(event: string, payload: CloseEventDouble): void {
      for (const listener of this.handlers.get(event) ?? []) listener(payload)
    }

    close(): void {
      const event: CloseEventDouble = {
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true },
      }
      this.lastCloseEvent = event
      this.emit('close', event)
      if (!event.defaultPrevented) {
        this.destroyed = true
        this.emit('closed', event)
      }
    }

    show(): void { this.visible = true }
    hide(): void { this.visible = false }
    focus(): void { this.focused = true }
    restore(): void { this.minimized = false }
    minimize(): void { this.minimized = true }
    maximize(): void { this.maximized = true }
    unmaximize(): void { this.maximized = false }
    isMaximized(): boolean { return this.maximized }
    isMinimized(): boolean { return this.minimized }
    isDestroyed(): boolean { return this.destroyed }
    loadFile(): void {}
    loadURL(): void {}
  }

  class Tray {
    static instances: Tray[] = []
    private listeners = new Map<string, Array<() => void>>()
    contextMenu: { template: Array<{ click?: () => void }> } | null = null

    constructor(iconPath: string) {
      Tray.instances.push(this)
      state.trays.push(this)
      state.trayIconPaths.push(iconPath)
    }

    setToolTip(): void {}
    setContextMenu(menu: { template: Array<{ click?: () => void }> }): void {
      this.contextMenu = menu
    }
    on(event: string, listener: () => void): this {
      const listeners = this.listeners.get(event) ?? []
      listeners.push(listener)
      this.listeners.set(event, listeners)
      return this
    }
    click(): void {
      for (const listener of this.listeners.get('click') ?? []) listener()
    }
  }

  return {
    BrowserWindow,
    Tray,
    Menu: { buildFromTemplate: (template: Array<{ click?: () => void }>) => ({ template }) },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    shell: { openExternal: () => {} },
  }
})

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

function setup(quitting = false) {
  let isQuitting = quitting
  const manager = new WindowManager({
    preloadPath: '/preload.js',
    rendererHtmlPath: '/index.html',
    isQuitting: () => isQuitting,
  })
  const window = manager.createMainWindow() as unknown as WindowDouble
  return {
    manager,
    window,
    setQuitting(value: boolean) { isQuitting = value },
  }
}

beforeEach(() => {
  state.windows.length = 0
  state.trays.length = 0
  state.trayIconPaths.length = 0
})

describe('main window tray lifecycle', () => {
  it('关闭主窗口只隐藏，再次打开复用同一窗口', () => {
    const { manager, window } = setup()
    manager.closeMain()

    expect(window.lastCloseEvent?.defaultPrevented).toBe(true)
    expect(window.destroyed).toBe(false)
    expect(window.visible).toBe(false)

    manager.createMainWindow()
    expect(state.windows).toHaveLength(1)
    expect(window.visible).toBe(true)
    expect(window.focused).toBe(true)
  })

  it('真正退出时允许主窗口销毁', () => {
    const { manager, window, setQuitting } = setup()
    setQuitting(true)
    manager.closeMain()

    expect(window.lastCloseEvent?.defaultPrevented).toBe(false)
    expect(window.destroyed).toBe(true)
  })

  it('恢复已最小化的主窗口', () => {
    const { manager, window } = setup()
    window.minimized = true
    manager.createMainWindow()

    expect(window.minimized).toBe(false)
    expect(window.visible).toBe(true)
  })

  it('托盘点击恢复窗口，退出菜单执行真实退出回调', () => {
    const { manager, window } = setup()
    let quitCalls = 0
    expect(typeof manager.createTray).toBe('function')
    const tray = manager.createTray(() => { quitCalls++ }) as unknown as TrayDouble
    expect(state.trayIconPaths).toEqual([join(process.cwd(), 'public/Logo/icon.png')])

    manager.closeMain()
    tray.click()
    expect(window.visible).toBe(true)

    tray.contextMenu?.template.at(-1)?.click?.()
    expect(quitCalls).toBe(1)
  })
})
