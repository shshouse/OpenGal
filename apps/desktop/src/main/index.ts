import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindowManager } from './windows/windowManager'
import { registerIpc } from './ipc/registerIpc'
import {
  registerModProtocolHandler,
  registerModProtocolSchemes
} from './services/modProtocol'
import { registerTTSServerCleanup, stopTTSServer } from './services/ttsServer'

registerModProtocolSchemes()
registerTTSServerCleanup()

let windows = createWindowManager('../renderer/index.html')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.opengal.desktop')
  registerModProtocolHandler()

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Re-instantiate after ready so app.getAppPath resolves in production
  windows = createWindowManager('../renderer/index.html')
  registerIpc(windows)
  windows.createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void stopTTSServer()
})
