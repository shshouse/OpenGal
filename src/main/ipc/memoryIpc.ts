import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
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
  archiveMessagesRange,
  latestMessageId,
  listSummaries,
  addSummary,
  commitCompression,
  memoryEvidence,
  listMemoryChanges,
} from '../services/memoryDb'
import {
  roleIdSchema,
  chatMessageSchema,
  memoryApplyPayloadSchema,
  memoryEntitySchema,
  summarySchema,
} from '@shared/schemas'
import { externalizeMessage } from '../services/media'
import { handleValidated, handleValidatedWithEvent } from './validated'
import { wrap } from './wrap'
import { z } from 'zod'

export function registerMemoryIpc(): void {
  // 消息 content 列存完整消息对象 JSON；兼容旧 JSON 导入的裸 content 格式
  // 附带 dbId 供归档锚点使用
  const rowToChatMessage = (row: { id?: number; role: string; content: string; ts?: number }): ChatMessage => {
    try {
      const parsed = JSON.parse(row.content) as unknown
      const base = (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'role' in (parsed as Record<string, unknown>))
        ? (parsed as ChatMessage)
        : { role: row.role as ChatMessage['role'], content: parsed as ChatMessage['content'] }
      return { ...base, dbId: row.id, ts: row.ts } as ChatMessage
    } catch {
      return { role: row.role as ChatMessage['role'], content: row.content, dbId: row.id, ts: row.ts } as ChatMessage
    }
  }

  ipcMain.handle(IpcChannels.chatHistory.load, (_, roleId: string) =>
    wrap<ChatMessage[]>(async () => {
      await memoryDbReady()
      return listUnarchivedMessages(roleId).map(rowToChatMessage)
    })
  )
  handleValidated(
    IpcChannels.chatHistory.append,
    [roleIdSchema, z.array(chatMessageSchema)],
    async (roleId, messages) => {
      await memoryDbReady()
      return saveChatMessages(roleId, messages.map((message) => externalizeMessage(message)))
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
          content: JSON.stringify(externalizeMessage(m)),
          ts: m.ts ?? Date.now(),
          archived: 0,
        })),
      )
      return true
    },
  )
  handleValidated(
    IpcChannels.chatHistory.archiveRange,
    [roleIdSchema, z.number().int(), z.number().int()],
    (roleId, fromId, toId) => archiveMessagesRange(roleId, fromId, toId),
  )
  ipcMain.handle(IpcChannels.chatHistory.latestMessageId, (_, roleId: string) =>
    wrap<number | null>(() => latestMessageId(roleId))
  )
  ipcMain.handle(IpcChannels.chatHistory.summaries, (_, roleId: string) =>
    wrap(() => listSummaries(roleId))
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

  ipcMain.handle(IpcChannels.memory.get, (_, roleId: string) =>
    wrap(async () => ({
      facts: await loadFacts(roleId),
      stories: await loadStories(roleId),
      block: await getMemoryBlock(roleId)
    }))
  )
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
  ipcMain.handle(IpcChannels.memory.prune, (_, roleId: string) =>
    wrap(() => pruneOverflow(roleId))
  )
  ipcMain.handle(IpcChannels.memory.evidence, (_, roleId: string, memoryId: string) =>
    wrap(() => memoryEvidence(roleId, memoryId))
  )
  ipcMain.handle(IpcChannels.memory.changes, (_, roleId: string, memoryId: string, limit?: number) =>
    wrap(() => listMemoryChanges(roleId, memoryId, limit))
  )
  ipcMain.handle(IpcChannels.memory.pending, (_, roleId: string, limit?: number) =>
    wrap(() => pendingFromArchive(roleId, limit))
  )
  ipcMain.handle(IpcChannels.memory.advanceCursor, (_, roleId: string, ts: number) =>
    wrap(() => advanceCursor(roleId, ts))
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
  // 只回记忆块：每轮都调用，不该把整张记忆表序列化过去
  ipcMain.handle(IpcChannels.memory.getRelevant, (_, roleId: string, context: string) =>
    wrap(async () => ({
      block: await getMemoryBlock(roleId, context, true)
    }))
  )
}
