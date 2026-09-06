import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindowManager } from './windows/windowManager'
import { registerIpc } from './ipc/registerIpc'
import {
  registerModProtocolHandler,
  registerModProtocolSchemes
} from './services/modProtocol'
import { registerTTSServerCleanup, stopTTSServer } from './services/ttsServer'
import { getDataRoot, getModRoot, isDevRuntime } from './services/paths'
import { flushMemoryDb } from './services/memoryDb'
import { logBus } from './services/logBus'

registerModProtocolSchemes()
registerTTSServerCleanup()
// Chromium userData（Local Storage、缓存、崩溃报告）尽量收进软件目录，卸载即无痕
// dev 指到项目内；打包版指到 exe 同级 userdata/，权限失败则回落默认 AppData
if (isDevRuntime()) {
  app.setPath('userData', path.join(path.resolve(path.dirname(app.getPath('exe')), '../../../'), '.dev-userdata'))
} else {
  const portableUserData = path.join(path.dirname(app.getPath('exe')), 'userdata')
  try {
    fs.mkdirSync(portableUserData, { recursive: true })
    fs.accessSync(portableUserData, fs.constants.W_OK)
    app.setPath('userData', portableUserData)
  } catch {
    /* 目录不可写（如装到 Program Files），保持默认 AppData */
  }
}
if (process.env.OPENGAL_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.OPENGAL_CDP_PORT)
}

let windows = createWindowManager('../renderer/index.html')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.opengal.desktop')
  registerModProtocolHandler()

  app.on('render-process-gone', (_event, _wc, details) => {
    logBus.error('app', `渲染进程崩溃: ${details.reason} (exitCode=${details.exitCode})`)
  })
  process.on('uncaughtException', (err) => {
    console.error('[fatal] 主进程未捕获异常:', err.stack ?? err.message)
    logBus.error('app', `主进程未捕获异常: ${err.stack ?? err.message}`)
    process.exit(1)
  })

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  windows = createWindowManager('../renderer/index.html')
  registerIpc(windows)
  logBus.info('app', 'OpenGal 主进程启动')
  logBus.info('app', `__dirname: ${__dirname}`)
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
  flushMemoryDb()
  void stopTTSServer()
})
