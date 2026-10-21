import { app } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import { logBus } from './logBus'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// 自动更新只对 NSIS 安装目录生效：安装目录里有 Update.exe。
// zip 便携版没有安装器，跳过检查，避免无意义的报错。
export function initUpdater(): void {
  if (!app.isPackaged) return
  const isInstalled = existsSync(path.join(path.dirname(process.execPath), 'Update.exe'))
  if (!isInstalled) {
    logBus.info('updater', '便携版不启用自动更新')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => logBus.warn('updater', `更新检查失败: ${err.message}`))
  autoUpdater.on('update-available', (info) => logBus.info('updater', `发现新版本 ${info.version}，开始后台下载`))
  autoUpdater.on('update-not-available', () => logBus.info('updater', '已是最新版本'))
  autoUpdater.on('update-downloaded', (info) =>
    logBus.info('updater', `新版本 ${info.version} 已下载，退出后自动安装`),
  )

  const check = (): void => {
    void autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => logBus.warn('updater', err.message))
  }
  setTimeout(check, 15_000)
  setInterval(check, CHECK_INTERVAL_MS)
}
