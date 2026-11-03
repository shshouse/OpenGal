import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type { AppConfig } from '@shared/types'
import { readConfig, writeConfig } from '../services/configStore'
import { resolveDefaultModel, scanModel, resolveModelFromCard } from '../services/modelScanner'
import { listRoleCards, getRoleCard, readRoleVoiceConfig } from '../services/roleCardLoader'
import { warmupTTS } from '../services/ttsClient'
import type { WindowManager } from '../windows/windowManager'
import { wrap } from './wrap'
import { handleValidated } from './validated'
import { configPatchSchema } from '@shared/schemas'
import { z } from 'zod'

export function registerConfigIpc(windows: WindowManager): void {

  ipcMain.handle(IpcChannels.config.get, () => wrap<AppConfig>(() => readConfig()))

  handleValidated(IpcChannels.config.set, [configPatchSchema], (patch) => {
    const next = writeConfig(patch as Partial<AppConfig>)
    if (patch.activeCharacterId !== undefined) void warmupTTS()
    const excludeSelf = patch.screen?.excludeSelf
    if (typeof excludeSelf === 'boolean') windows.setSelfExclusion(excludeSelf)
    return next
  })

  ipcMain.handle(IpcChannels.model.resolveDefault, () =>
    wrap(() => resolveDefaultModel())
  )

  handleValidated(IpcChannels.model.resolveFromCard, [z.string().min(1)], (cardId) => {
    const card = getRoleCard(cardId)
    if (!card) return null
    return resolveModelFromCard(card)
  })

  handleValidated(IpcChannels.model.scan, [z.string().min(1), z.string().min(1)], (folderPath, modelJsonFile) =>
    scanModel(folderPath, modelJsonFile),
  )

  ipcMain.handle(IpcChannels.character.list, () => wrap(() => listRoleCards()))
  handleValidated(IpcChannels.character.get, [z.string().min(1)], (id) => getRoleCard(id))
  handleValidated(IpcChannels.character.voiceConfig, [z.string().min(1)], (id) => {
    const card = getRoleCard(id)
    return card ? readRoleVoiceConfig(card) : null
  })
}
