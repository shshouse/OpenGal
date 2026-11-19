import { BrowserWindow, dialog } from 'electron'
import { IpcChannels } from '@shared/app/ipc-channels'
import type { ChatMessage } from '@shared/types'
import {
  loadFacts,
  loadStories,
  getMemoryBlock,
  applyCandidates,
  manualAddFact,
  clearMemory,
  freezeFact,
  unfreezeFact,
  deleteFact,
  pendingFromArchive,
  advanceCursor,
  rebuildMemory,
  pruneOverflow,
} from '../services/memory'
import {
  memoryDbReady,
  listUnarchivedMessages,
  saveChatMessages,
  replaceUnarchivedMessages,
  updateMessageTranslation,
  archiveMessagesRange,
  latestMessageId,
  listSummaries,
  addSummary,
  commitCompression,
  memoryEvidence,
  listMemoryChanges,
} from '../services/memory/db'
import {
  roleIdSchema,
  chatMessageSchema,
  memoryApplyPayloadSchema,
  memoryEntitySchema,
  summarySchema,
} from '@shared/app/schemas'
import { externalizeRoleMessage, hydrateRoleMessageUrls } from '../services/infra/media'
import { handleValidated, handleValidatedWithEvent } from './validated'
import { z } from 'zod'

const translationTargetSchema = z.object({
  dbId: z.number().int().positive().optional(),
  clientId: z.string().min(1).max(128).optional(),
})

export function registerMemoryIpc(): void {
  const rowToChatMessage = (
    roleId: string,
    row: {
      id?: number
      role: string
      content: string
      ts?: number
      client_id?: string | null
      translation?: string | null
      translation_lang?: string | null
    },
  ): ChatMessage => {
    try {
      const parsed = JSON.parse(row.content) as unknown
      const base =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'role' in (parsed as Record<string, unknown>)
          ? (parsed as ChatMessage)
          : { role: row.role as ChatMessage['role'], content: parsed as ChatMessage['content'] }
      return hydrateRoleMessageUrls(roleId, {
        ...base,
        dbId: row.id,
        ts: row.ts,
        ...(row.client_id ? { clientId: row.client_id } : {}),
        ...(row.translation ? { translation: row.translation } : {}),
        ...(row.translation_lang ? { translationLang: row.translation_lang } : {}),
      } as ChatMessage)
    } catch {
      return {
        role: row.role as ChatMessage['role'],
        content: row.content,
        dbId: row.id,
        ts: row.ts,
        ...(row.client_id ? { clientId: row.client_id } : {}),
        ...(row.translation ? { translation: row.translation } : {}),
        ...(row.translation_lang ? { translationLang: row.translation_lang } : {}),
      } as ChatMessage
    }
  }

  handleValidated(IpcChannels.chatHistory.load, [roleIdSchema], async (roleId) => {
    await memoryDbReady()
    return listUnarchivedMessages(roleId).map((row) => rowToChatMessage(roleId, row))
  })
  handleValidated(
    IpcChannels.chatHistory.append,
    [roleIdSchema, z.array(chatMessageSchema)],
    async (roleId, messages) => {
      await memoryDbReady()
      return saveChatMessages(roleId, messages.map((message) => externalizeRoleMessage(roleId, message)))
    },
  )
  handleValidated(
    IpcChannels.chatHistory.replaceAll,
    [roleIdSchema, z.array(chatMessageSchema)],
    (roleId, messages) => {
      replaceUnarchivedMessages(
        roleId,
        messages.map((m) => ({
          id: m.dbId,
          role_id: roleId,
          role: m.role,
          content: JSON.stringify(externalizeRoleMessage(roleId, m)),
          ts: m.ts ?? Date.now(),
          archived: 0,
          client_id: m.clientId ?? null,
          translation: m.translation ?? null,
          translation_lang: m.translationLang ?? null,
        })),
      )
      return true
    },
  )
  handleValidated(
    IpcChannels.chatHistory.setTranslation,
    [roleIdSchema, translationTargetSchema, z.string().min(1).max(20_000), z.string().max(32)],
    async (roleId, target, translation, translationLang) => {
      await memoryDbReady()
      return updateMessageTranslation(roleId, target, translation, translationLang)
    },
  )
  handleValidated(
    IpcChannels.chatHistory.archiveRange,
    [roleIdSchema, z.number().int(), z.number().int()],
    (roleId, fromId, toId) => archiveMessagesRange(roleId, fromId, toId),
  )
  handleValidated(IpcChannels.chatHistory.latestMessageId, [roleIdSchema], (roleId) =>
    latestMessageId(roleId),
  )
  handleValidated(IpcChannels.chatHistory.summaries, [roleIdSchema], (roleId) =>
    listSummaries(roleId),
  )
  handleValidated(
    IpcChannels.chatHistory.summaryAdd,
    [roleIdSchema, summarySchema],
    (roleId, s) => {
      addSummary(roleId, s)
      return true
    },
  )
  handleValidated(
    IpcChannels.chatHistory.commitCompression,
    [roleIdSchema, z.number().int(), z.number().int(), summarySchema],
    (roleId, fromId, toId, s) => commitCompression(roleId, fromId, toId, s),
  )

  handleValidated(IpcChannels.memory.get, [roleIdSchema], async (roleId) => ({
    facts: await loadFacts(roleId),
    stories: await loadStories(roleId),
    block: await getMemoryBlock(roleId),
  }))
  handleValidated(
    IpcChannels.memory.apply,
    [roleIdSchema, memoryApplyPayloadSchema],
    (roleId, payload) => applyCandidates(roleId, payload),
  )
  handleValidated(
    IpcChannels.memory.manualAdd,
    [roleIdSchema, z.string().min(1), memoryEntitySchema.optional()],
    (roleId, text, entity) => manualAddFact(roleId, text, entity),
  )
  handleValidated(IpcChannels.memory.clear, [roleIdSchema], (roleId) =>
    clearMemory(roleId),
  )
  handleValidated(IpcChannels.memory.prune, [roleIdSchema], (roleId) =>
    pruneOverflow(roleId),
  )
  handleValidated(
    IpcChannels.memory.evidence,
    [roleIdSchema, z.string().min(1)],
    (roleId, memoryId) => memoryEvidence(roleId, memoryId),
  )
  handleValidated(
    IpcChannels.memory.changes,
    [roleIdSchema, z.string().min(1), z.number().int().min(1).max(500).optional()],
    (roleId, memoryId, limit) => listMemoryChanges(roleId, memoryId, limit),
  )
  handleValidated(
    IpcChannels.memory.pending,
    [roleIdSchema, z.number().int().min(1).max(200).optional()],
    (roleId, limit) => pendingFromArchive(roleId, limit),
  )
  handleValidated(
    IpcChannels.memory.advanceCursor,
    [roleIdSchema, z.number().finite()],
    (roleId, ts) => advanceCursor(roleId, ts),
  )
  handleValidatedWithEvent(
    IpcChannels.memory.rebuild,
    [roleIdSchema, z.string().min(1)],
    async (event, roleId, confirm) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const { response } = await dialog.showMessageBox(win!, {
        type: 'warning',
        title: '从原文重建记忆',
        message: '将清空已提取的事实和经历，从最早的对话重新提取。',
        detail: '聊天原文不受影响。重建会重新调用模型，可能较慢并产生费用；建议先备份 data 目录。',
        buttons: ['重建', '取消'],
        defaultId: 1,
        cancelId: 1,
      })
      if (response !== 0) throw new Error('已取消重建')
      return rebuildMemory(roleId, confirm)
    },
  )
  handleValidated(IpcChannels.memory.freezeFact, [roleIdSchema, z.string().min(1)], (roleId, factId) =>
    freezeFact(roleId, factId),
  )
  handleValidated(IpcChannels.memory.unfreezeFact, [roleIdSchema, z.string().min(1)], (roleId, factId) =>
    unfreezeFact(roleId, factId),
  )
  handleValidated(IpcChannels.memory.deleteFact, [roleIdSchema, z.string().min(1)], (roleId, factId) =>
    deleteFact(roleId, factId),
  )
  handleValidated(
    IpcChannels.memory.getRelevant,
    [roleIdSchema, z.string()],
    async (roleId, context) => ({
      block: await getMemoryBlock(roleId, context, true),
    }),
  )
}
