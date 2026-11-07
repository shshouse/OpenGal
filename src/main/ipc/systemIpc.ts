import { ipcMain, desktopCapturer } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type { MateStatePayload } from '@shared/mate'
import { fetchMarketMods, openMarketMod } from '../services/marketService'
import { getEnvSnapshot } from '../services/envContext'
import { runBootSequence, recheckTts } from '../services/bootService'
import type { WindowManager } from '../windows/windowManager'
import { wrap } from './wrap'
import { getErrorMessage } from '@shared/errors'

const BUBBLE_MAX_CHARS = 500

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined)

/** mate:sync 的入口校验：只取已知字段，避免渲染层任意结构透传到另一个窗口。 */
function parseMateState(value: unknown): MateStatePayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'bubble': {
      const text = str(raw.text)
      return text === undefined ? null : { type: 'bubble', text: text.slice(0, BUBBLE_MAX_CHARS) }
    }
    case 'performance':
      return {
        type: 'performance',
        emotion: str(raw.emotion),
        motion: str(raw.motion),
        roleId: str(raw.roleId),
        speaking: bool(raw.speaking),
      }
    case 'runtime':
      return {
        type: 'runtime',
        runningRoles:
          raw.runningRoles && typeof raw.runningRoles === 'object'
            ? (raw.runningRoles as Record<string, boolean>)
            : {},
        activeRoleId: str(raw.activeRoleId) ?? null,
      }
    case 'avatar': {
      const dataUrl = str(raw.dataUrl)
      return dataUrl === undefined ? null : { type: 'avatar', dataUrl }
    }
    default:
      return null
  }
}

export function registerSystemIpc(windows: WindowManager): void {
  ipcMain.handle(IpcChannels.mate.control, (_, control: unknown) =>
    wrap(() => {
      switch (control) {
        case 'open':
          return windows.openMateWindow()
        case 'close':
          return windows.closeMateWindow()
        case 'dragStart':
          return windows.dragMateStart()
        case 'dragMove':
          return windows.dragMateMove()
        default:
          throw new Error(`未知的相伴控制指令: ${String(control)}`)
      }
    })
  )

  // 气泡是高频推送；主窗口与相伴窗口共享同一次表演，状态统一经 mate:sync 上送
  ipcMain.on(IpcChannels.mate.sync, (_, payload: unknown) => {
    const state = parseMateState(payload)
    if (state) windows.dispatchMateState(state)
  })

  ipcMain.handle(IpcChannels.window.minimize, () => {
    windows.minimizeMain()
  })
  ipcMain.handle(IpcChannels.window.maximize, () => {
    windows.maximizeMain()
  })
  ipcMain.handle(IpcChannels.window.close, () => {
    windows.closeMain()
  })
  ipcMain.handle(IpcChannels.window.isMaximized, () => {
    return windows.isMainMaximized()
  })

  ipcMain.handle(
    IpcChannels.market.list,
    (_, options: { page?: number; sort?: string; category?: string }) =>
      wrap(() => fetchMarketMods(options ?? {}))
  )
  ipcMain.handle(IpcChannels.market.open, (_, modNumber: number, versionId?: string) =>
    wrap(() => openMarketMod(modNumber, versionId))
  )

  ipcMain.handle(IpcChannels.screen.capture, async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 1280 }
      })
      const primary = sources.find((s) => s.display_id !== '') ?? sources[0]
      if (!primary) return { success: false, error: 'no screen source' }
      return { success: true, data: primary.thumbnail.toPNG().toString('base64') }
    } catch (err) {
      return { success: false, error: getErrorMessage(err) }
    }
  })

  ipcMain.handle(IpcChannels.env.get, () => wrap(() => getEnvSnapshot()))

  ipcMain.handle(IpcChannels.boot.start, (event) => {
    const sender = event.sender
    return wrap(() =>
      runBootSequence((step) => {
        if (!sender.isDestroyed()) sender.send(IpcChannels.boot.step, step)
      })
    )
  })

  ipcMain.handle(IpcChannels.boot.recheckTts, (event) => {
    const sender = event.sender
    recheckTts((step) => {
      if (!sender.isDestroyed()) sender.send(IpcChannels.boot.step, step)
    })
    return wrap(() => true)
  })
}
