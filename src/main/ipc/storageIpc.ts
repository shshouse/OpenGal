import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import { getStorageUsage, revealDataRoot } from '../services/storageUsage'
import { wrap } from './wrap'

export function registerStorageIpc(): void {
  ipcMain.handle(IpcChannels.storage.usage, () => wrap(() => getStorageUsage()))
  ipcMain.handle(IpcChannels.storage.reveal, () => wrap(() => revealDataRoot()))
}
