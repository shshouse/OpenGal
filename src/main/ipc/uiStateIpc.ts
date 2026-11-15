import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/app/ipc-channels'
import type { UIStatePatch } from '@shared/ui/uiState'
import { getUIState, setUIState } from '../services/config/uiState'
import { wrap } from './wrap'

export function registerUIStateIpc(): void {
  ipcMain.handle(IpcChannels.uiState.get, () => wrap(() => getUIState()))
  ipcMain.handle(IpcChannels.uiState.set, (_, patch: UIStatePatch) =>
    wrap(() => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('uiState patch must be an object')
      }
      return setUIState(patch)
    })
  )
}
