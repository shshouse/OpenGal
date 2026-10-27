import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type { AppConfig } from '@shared/types'
import { readConfig, writeConfig } from '../services/configStore'
import { resolveDefaultModel, scanModel, resolveModelFromCard } from '../services/modelScanner'
import { listRoleCards, getRoleCard, readRoleVoiceConfig } from '../services/roleCardLoader'
import { warmupTTS } from '../services/ttsClient'
import type { WindowManager } from '../windows/windowManager'
import { wrap } from './wrap'

export function registerConfigIpc(windows: WindowManager): void {

  ipcMain.handle(IpcChannels.config.get, () => wrap<AppConfig>(() => readConfig()))

  ipcMain.handle(IpcChannels.config.set, (_, patch: Partial<AppConfig>) =>
    wrap<AppConfig>(() => {
      const next = writeConfig(patch)
      if (patch.activeCharacterId !== undefined) void warmupTTS()
      if (patch.screen?.excludeSelf !== undefined) windows.setSelfExclusion(patch.screen.excludeSelf)
      return next
    })
  )

  ipcMain.handle(IpcChannels.model.resolveDefault, () =>
    wrap(() => resolveDefaultModel())
  )

  ipcMain.handle(
    IpcChannels.model.resolveFromCard,
    (_, cardId: string) => wrap(() => {
      const card = getRoleCard(cardId)
      if (!card) return null
      return resolveModelFromCard(card)
    })
  )

  ipcMain.handle(
    IpcChannels.model.scan,
    (_, folderPath: string, modelJsonFile: string) =>
      wrap(() => scanModel(folderPath, modelJsonFile))
  )

  ipcMain.handle(IpcChannels.character.list, () => wrap(() => listRoleCards()))
  ipcMain.handle(IpcChannels.character.get, (_, id: string) =>
    wrap(() => getRoleCard(id))
  )
  ipcMain.handle(IpcChannels.character.voiceConfig, (_, id: string) =>
    wrap<Record<string, unknown> | null>(() => {
      const card = getRoleCard(id)
      return card ? readRoleVoiceConfig(card) : null
    })
  )
}
