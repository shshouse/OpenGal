import { dialog, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { IpcChannels } from '@shared/app/ipc-channels'
import { createBlankRoleSchema, roleAvatarSchema, roleExampleTurnSchema, roleIdSchema, roleModeSchema } from '@shared/app/schemas'
import { getBackupRoot, getDataRoot } from '../services/infra/paths'
import { clearLifeLogs, getRoleState, listLifeLogs, patchRoleState } from '../services/memory/db'
import { scanMods } from '../services/mods/scanner'
import { getOwnedRoleCard, listRoleTemplates } from '../services/role/cardLoader'
import { deleteOwnedRole, exportOwnedRoleFolder } from '../services/role/lifecycle'
import { readRoleLogs } from '../services/role/roleLogs'
import { createBlankRoleDir } from '../services/role/store'
import {
  executeLifeTick,
  focusRoleInPool,
  getRuntimePoolSnapshot,
  notifyUserActivityOnRole,
  setRoleLifePausedInPool,
  setRoleModeInPool,
  setRoleRunningInPool,
} from '../services/runtime/roleRuntimePool'
import {
  deleteWorkshopDraft,
  downloadDraftAssetFromUrl,
  exportDraftAsModPack,
  finalizeWorkshopDraftToRole,
  getWorkshopDraft,
  listWorkshopDrafts,
  pickLocalDraftAsset,
  publishDraftToMikuMod,
  readDraftPortraitDataUrl,
  saveWorkshopDraft,
} from '../services/workshop/roleWorkshop'
import { handleValidated } from './validated'
import { wrap } from './wrap'

const saveDraftIpcSchema = z.object({
  draftId: z.string().max(64).optional(),
  name: z.string().min(1).max(64),
  displayName: z.string().max(64).optional(),
  color: z.string().max(16).optional(),
  language: z.string().max(16).optional(),
  mode: roleModeSchema.optional(),
  greeting: z.string().max(2000).optional(),
  examples: z.array(roleExampleTurnSchema).max(40).optional(),
  persona: z.object({
    description: z.string().min(1).max(20_000),
    personality: z.string().min(1).max(20_000),
    scenario: z.string().max(20_000).optional(),
    rules: z.string().max(20_000).optional(),
    userIdentity: z.string().max(2_000).optional(),
    userTerm: z.string().max(200).optional(),
  }),
  voice: z
    .object({
      engine: z.enum(['fish', 'gpt-sovits', 'genie', 'none']).optional(),
      fishReferenceId: z.string().max(128).optional(),
      referenceAudioRelPath: z.string().max(256).optional(),
      referenceText: z.string().max(1000).optional(),
      language: z.string().max(16).optional(),
    })
    .optional(),
  avatar: roleAvatarSchema.nullable().optional(),
  provenance: z
    .object({
      kind: z.enum(['original', 'authorized-derivative', 'recipe-only', 'local-personal']).optional(),
      license: z.string().max(200).optional(),
      credits: z.string().max(500).optional(),
      sourceNotes: z.string().max(2000).optional(),
    })
    .optional(),
})

const patchStateSchema = z.object({
  mood: z.string().max(32).optional(),
  energy: z.number().min(0).max(100).optional(),
  relationshipStage: z.string().max(120).optional(),
  currentActivity: z.string().max(200).optional(),
  shortTermGoal: z.string().max(500).optional(),
})

export function registerRuntimeAndWorkshopIpc(): void {
  ipcMain.handle(IpcChannels.mods.list, () => wrap(() => scanMods()))
  ipcMain.handle(IpcChannels.role.templates, () => wrap(() => listRoleTemplates()))

  handleValidated(IpcChannels.role.createBlank, [createBlankRoleSchema], async (input) => {
    const created = createBlankRoleDir(getDataRoot(), input)
    const card = getOwnedRoleCard(created.roleId)
    if (!card) throw new Error('创建角色后读取失败')
    await setRoleRunningInPool(card.id, true)
    focusRoleInPool(card.id)
    return card
  })

  handleValidated(IpcChannels.role.delete, [roleIdSchema], async (roleId) => {
    try {
      await setRoleRunningInPool(roleId, false)
    } catch {
      /* ignore if already absent */
    }
    return deleteOwnedRole(getDataRoot(), roleId, getBackupRoot())
  })

  handleValidated(IpcChannels.role.exportFolder, [roleIdSchema], async (roleId) => {
    const picked = await dialog.showOpenDialog({
      title: '选择导出角色目录的目标位置（整包可直接迁移到其他 OpenGal）',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    const exported = exportOwnedRoleFolder(getDataRoot(), roleId, picked.filePaths[0])
    shell.showItemInFolder(exported)
    return exported
  })

  handleValidated(IpcChannels.role.getState, [roleIdSchema], (roleId) => getRoleState(roleId))
  handleValidated(IpcChannels.role.patchState, [roleIdSchema, patchStateSchema], (roleId, patch) =>
    patchRoleState(roleId, patch),
  )
  handleValidated(
    IpcChannels.role.lifeLogs,
    [roleIdSchema, z.number().int().min(1).max(200).optional()],
    (roleId, limit) => listLifeLogs(roleId, { limit: limit ?? 50 }),
  )
  handleValidated(
    IpcChannels.role.clearLifeLogs,
    [roleIdSchema, z.enum(['all', 'traces', 'diary']).optional()],
    (roleId, scope) => clearLifeLogs(roleId, scope ?? 'traces'),
  )
  handleValidated(
    IpcChannels.role.roleLogs,
    [roleIdSchema, z.number().int().min(1).max(500).optional()],
    (roleId, limit) => readRoleLogs(roleId, limit ?? 100),
  )

  ipcMain.handle(IpcChannels.runtime.snapshot, () => wrap(() => getRuntimePoolSnapshot()))
  handleValidated(
    IpcChannels.runtime.setRunning,
    [roleIdSchema, z.boolean()],
    (roleId, running) => setRoleRunningInPool(roleId, running),
  )
  handleValidated(
    IpcChannels.runtime.setMode,
    [roleIdSchema, roleModeSchema],
    (roleId, mode) => setRoleModeInPool(roleId, mode),
  )
  handleValidated(
    IpcChannels.runtime.setLifePaused,
    [roleIdSchema, z.boolean()],
    (roleId, paused) => setRoleLifePausedInPool(roleId, paused),
  )
  handleValidated(
    IpcChannels.runtime.focus,
    [z.string().min(1).nullable()],
    (roleId) => focusRoleInPool(roleId),
  )
  handleValidated(
    IpcChannels.runtime.userActivity,
    [roleIdSchema],
    (roleId) => {
      notifyUserActivityOnRole(roleId)
      return true
    },
  )
  handleValidated(
    IpcChannels.runtime.triggerLifeTick,
    [roleIdSchema],
    (roleId) => executeLifeTick(roleId, true),
  )

  ipcMain.handle(IpcChannels.workshop.list, () => wrap(() => listWorkshopDrafts()))
  handleValidated(IpcChannels.workshop.get, [z.string().min(1).max(64)], (draftId) =>
    getWorkshopDraft(draftId),
  )
  handleValidated(IpcChannels.workshop.save, [saveDraftIpcSchema], (input) =>
    saveWorkshopDraft(input),
  )
  handleValidated(IpcChannels.workshop.delete, [z.string().min(1).max(64)], (draftId) =>
    deleteWorkshopDraft(draftId),
  )
  handleValidated(
    IpcChannels.workshop.pickAsset,
    [z.string().min(1).max(64), z.enum(['portrait', 'voice'])],
    (draftId, kind) => pickLocalDraftAsset(draftId, kind),
  )
  handleValidated(
    IpcChannels.workshop.fetchAsset,
    [z.string().min(1).max(64), z.enum(['portrait', 'voice']), z.string().url().max(2000)],
    (draftId, kind, url) => downloadDraftAssetFromUrl(draftId, kind, url),
  )
  handleValidated(IpcChannels.workshop.portraitPreview, [z.string().min(1).max(64)], (draftId) =>
    readDraftPortraitDataUrl(draftId),
  )
  handleValidated(IpcChannels.workshop.finalizeRole, [z.string().min(1).max(64)], async (draftId) => {
    const card = finalizeWorkshopDraftToRole(draftId)
    await setRoleRunningInPool(card.id, true)
    focusRoleInPool(card.id)
    return card
  })
  handleValidated(IpcChannels.workshop.exportMod, [z.string().min(1).max(64)], async (draftId) => {
    const picked = await dialog.showOpenDialog({
      title: '选择导出模组包的目标目录（可直接选 mods 目录或任意目录）',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    const out = exportDraftAsModPack(draftId, picked.filePaths[0])
    shell.showItemInFolder(out.modPath)
    return out
  })
  handleValidated(IpcChannels.workshop.publishMikuMod, [z.string().min(1).max(64)], (draftId) =>
    publishDraftToMikuMod(draftId),
  )
}
