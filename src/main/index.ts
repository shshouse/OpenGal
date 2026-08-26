import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindowManager } from './windows/windowManager'
import { registerIpc } from './ipc/registerIpc'
import {
  registerModProtocolHandler,
  registerModProtocolSchemes
} from './services/modProtocol'
import { registerTTSServerCleanup, stopTTSServer } from './services/ttsServer'
import { getDataRoot, getModRoot } from './services/paths'
import { logBus } from './services/logBus'

registerModProtocolSchemes()
registerTTSServerCleanup()

// 调试用：OPENGAL_CDP_PORT=9223 npm run dev 可开启远程调试端口，
// 便于外部脚本通过 CDP 驱动/检查渲染层（不设置则完全无影响）
if (process.env.OPENGAL_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.OPENGAL_CDP_PORT)
}

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
  logBus.info('app', 'OpenGal 主进程启动')
  logBus.info('app', `mods 根目录: ${getModRoot()}`)
  logBus.info('app', `数据目录: ${getDataRoot()}`)
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
