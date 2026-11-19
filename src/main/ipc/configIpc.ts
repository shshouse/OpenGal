import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/app/ipc-channels'
import type { AppConfig } from '@shared/types'
import { readConfig, writeConfig } from '../services/config/store'
import { resolveDefaultModel, scanModel, resolveModelFromCard } from '../services/role/modelScanner'
import { getRoleCard, listOwnedRoleCards, readRoleVoiceConfig } from '../services/role/cardLoader'
import { saveRoleCard } from '../services/role/cardWriter'
import { createRoleCopy } from '../services/role/roleCopy'
import { focusRoleInPool, setRoleRunningInPool } from '../services/runtime/roleRuntimePool'
import { warmupTTS } from '../services/tts/client'
import { setScreenWatchEnabled } from '../services/perception/screenWatch'
import type { WindowManager } from '../windows/windowManager'
import { wrap } from './wrap'
import { handleValidated } from './validated'
import { configPatchSchema, roleCardEditableSchema, roleIdSchema, roleModeSchema } from '@shared/app/schemas'
import { z } from 'zod'

export function registerConfigIpc(windows: WindowManager): void {

  ipcMain.handle(IpcChannels.config.get, () => wrap<AppConfig>(() => readConfig()))

  handleValidated(IpcChannels.config.set, [configPatchSchema], (patch) => {
    const next = writeConfig(patch as Partial<AppConfig>)
    if (patch.activeRoleId !== undefined) void warmupTTS()
    const excludeSelf = patch.screen?.excludeSelf
    if (typeof excludeSelf === 'boolean') windows.setSelfExclusion(excludeSelf)
    const watch = patch.screen?.watch
    if (typeof watch === 'boolean') setScreenWatchEnabled(watch)
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

  ipcMain.handle(IpcChannels.role.list, () => wrap(() => listOwnedRoleCards()))
  handleValidated(IpcChannels.role.get, [z.string().min(1)], (id) => getRoleCard(id))
  handleValidated(IpcChannels.role.voiceConfig, [z.string().min(1)], (id) => {
    const card = getRoleCard(id)
    return card ? readRoleVoiceConfig(card) : null
  })
  handleValidated(IpcChannels.role.saveCard, [roleIdSchema, roleCardEditableSchema], (id, fields) =>
    saveRoleCard(id, fields),
  )
  handleValidated(
    IpcChannels.role.createCopy,
    [roleIdSchema, z.string().max(64).optional(), roleModeSchema.optional()],
    async (id, name, mode) => {
      const created = createRoleCopy(id, name, mode)
      await setRoleRunningInPool(created.id, true)
      focusRoleInPool(created.id)
      return created
    },
  )
}
