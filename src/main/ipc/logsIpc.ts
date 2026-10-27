import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IpcChannels } from '@shared/ipc-channels'
import type { IpcResult } from '@shared/types'
import type { LogEntry } from '@shared/log'
import { addLogSubscriber, getAllLogs, clearLogs, logBus } from '../services/logBus'
import { getDataRoot } from '../services/paths'
import { wrap } from './wrap'

export function registerLogsIpc(): void {
  ipcMain.on(IpcChannels.director.log, (_, entry: Record<string, unknown>) => {
    const dir = path.join(getDataRoot(), 'logs')
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const file = path.join(dir, `director-${day}.ndjson`)
    fs.promises
      .mkdir(dir, { recursive: true })
      .then(() => fs.promises.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf-8'))
      .catch((err) => logBus.warn('director', `决策日志写入失败: ${(err as Error).message}`))
  })

  ipcMain.handle(IpcChannels.logs.list, (event) => {
    addLogSubscriber(event.sender)
    return { success: true, data: getAllLogs() } as IpcResult<LogEntry[]>
  })
  ipcMain.handle(IpcChannels.logs.clear, () => {
    clearLogs()
    logBus.info('logs', '日志已清空')
    return { success: true }
  })
  ipcMain.handle(IpcChannels.logs.reveal, () =>
    wrap(async () => {
      const dir = path.join(getDataRoot(), 'logs')
      await fs.promises.mkdir(dir, { recursive: true })
      const failure = await shell.openPath(dir)
      if (failure) throw new Error(failure)
      return true
    })
  )
  ipcMain.handle(IpcChannels.logs.export, (event, text: string) =>
    wrap(async () => {
      if (typeof text !== 'string' || text.length === 0) throw new Error('没有可导出的内容')
      const win = BrowserWindow.fromWebContents(event.sender)
      const now = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
      const options = {
        title: '导出运行日志',
        defaultPath: `opengal-log-${stamp}.log`,
        filters: [
          { name: '日志文件', extensions: ['log', 'txt'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await fs.promises.writeFile(result.filePath, text, 'utf-8')
      return result.filePath
    })
  )
  ipcMain.on(IpcChannels.logs.append, (_, level: string, source: string, message: string, details?: string) => {
    const lv = level === 'warn' || level === 'error' || level === 'debug' ? level : 'info'
    logBus[lv](source || 'renderer', message, details)
  })
}
