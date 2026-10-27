import { ipcMain, BrowserWindow } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import { getEngine } from '../services/asr/factory'
import { wrap } from './wrap'

export function registerAsrIpc(): void {
  ipcMain.handle(IpcChannels.asr.start, (event) => {
    const sender = BrowserWindow.fromWebContents(event.sender)?.webContents
    if (!sender) return { success: false, error: 'No window' }
    getEngine().setSpeechStartCallback(() => {
      if (!sender.isDestroyed()) sender.send(IpcChannels.asr.speechStart)
    })
    getEngine().setResultCallback((text, partial) => {
      if (sender.isDestroyed()) return
      sender.send(partial ? IpcChannels.asr.partial : IpcChannels.asr.final, text)
    })
    return wrap(() => getEngine().start())
  })

  ipcMain.handle(IpcChannels.asr.stop, () => {
    getEngine().setResultCallback(null)
    getEngine().setSpeechStartCallback(null)
    getEngine().stop()
    return { success: true }
  })

  ipcMain.on(IpcChannels.asr.feed, (_, buffer: ArrayBuffer) => {
    getEngine().feed(Buffer.from(buffer))
  })

  ipcMain.handle(IpcChannels.asr.status, () => {
    return { success: true, data: { running: getEngine().isRunning() } }
  })
}
