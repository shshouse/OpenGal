import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type { UIStatePatch } from '@shared/uiState'
import { getUIState, setUIState } from '../services/uiStateStore'
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
