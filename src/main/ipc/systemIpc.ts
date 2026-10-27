import { ipcMain, desktopCapturer } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import { fetchMarketMods, openMarketMod } from '../services/marketService'
import { getEnvSnapshot } from '../services/envContext'
import { runBootSequence, recheckTts } from '../services/bootService'
import type { WindowManager } from '../windows/windowManager'
import { wrap } from './wrap'

export function registerSystemIpc(windows: WindowManager): void {
  ipcMain.handle(IpcChannels.pet.open, () => wrap(() => windows.openPetWindow()))
  ipcMain.handle(IpcChannels.pet.close, () => wrap(() => windows.closePetWindow()))
  ipcMain.handle(IpcChannels.pet.dragStart, () => wrap(() => windows.dragPetStart()))
  ipcMain.handle(IpcChannels.pet.dragMove, () => wrap(() => windows.dragPetMove()))
  // 桌宠气泡是高频推送，走 send/on；文本截断防御
  ipcMain.on(IpcChannels.pet.setBubble, (_, text: unknown) => {
    if (typeof text === 'string') windows.sendPetBubble(text.slice(0, 500))
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
      return { success: false, error: (err as Error).message }
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
