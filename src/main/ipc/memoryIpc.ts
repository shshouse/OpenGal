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
} from '../services/memoryStore'
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
} from '../services/memoryDb'
import {
  characterIdSchema,
  chatMessageSchema,
  memoryApplyPayloadSchema,
  memoryEntitySchema,
  summarySchema,
} from '@shared/schemas'
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

  ipcMain.handle(IpcChannels.chatHistory.load, (_, characterId: string) =>
    wrap<ChatMessage[]>(async () => {
      await memoryDbReady()
      return listUnarchivedMessages(characterId).map(rowToChatMessage)
    })
  )
  handleValidated(
    IpcChannels.chatHistory.append,
    [characterIdSchema, z.array(chatMessageSchema)],
    async (characterId, messages) => {
      await memoryDbReady()
      return saveChatMessages(characterId, messages)
    },
  )
  handleValidated(
    IpcChannels.chatHistory.replaceAll,
    [characterIdSchema, z.array(chatMessageSchema)],
    (characterId, messages) => {
      replaceUnarchivedMessages(
        characterId,
        messages.map((m) => ({
          id: m.dbId,
          character_id: characterId,
          role: m.role,
          content: JSON.stringify(m),
          ts: m.ts ?? Date.now(),
          archived: 0,
        })),
      )
      return true
    },
  )
  handleValidated(
    IpcChannels.chatHistory.archiveRange,
    [characterIdSchema, z.number().int(), z.number().int()],
    (characterId, fromId, toId) => archiveMessagesRange(characterId, fromId, toId),
  )
  ipcMain.handle(IpcChannels.chatHistory.latestMessageId, (_, characterId: string) =>
    wrap<number | null>(() => latestMessageId(characterId))
  )
  ipcMain.handle(IpcChannels.chatHistory.summaries, (_, characterId: string) =>
    wrap(() => listSummaries(characterId))
  )
  handleValidated(
    IpcChannels.chatHistory.summaryAdd,
    [characterIdSchema, summarySchema],
    (characterId, s) => {
      addSummary(characterId, s)
      return true
    },
  )

  handleValidated(
    IpcChannels.chatHistory.commitCompression,
    [characterIdSchema, z.number().int(), z.number().int(), summarySchema],
    (characterId, fromId, toId, s) => commitCompression(characterId, fromId, toId, s),
  )

  ipcMain.handle(IpcChannels.memory.get, (_, characterId: string) =>
    wrap(async () => ({
      facts: await loadFacts(characterId),
      stories: await loadStories(characterId),
      block: await getMemoryBlock(characterId)
    }))
  )
  handleValidated(
    IpcChannels.memory.apply,
    [characterIdSchema, memoryApplyPayloadSchema],
    (characterId, payload) => applyCandidates(characterId, payload),
  )
  handleValidated(
    IpcChannels.memory.manualAdd,
    [characterIdSchema, z.string().min(1), memoryEntitySchema.optional()],
    (characterId, text, entity) => manualAddFact(characterId, text, entity),
  )
  handleValidated(IpcChannels.memory.clear, [characterIdSchema], (characterId) =>
    clearMemory(characterId),
  )
  ipcMain.handle(IpcChannels.memory.prune, (_, characterId: string) =>
    wrap(() => pruneOverflow(characterId))
  )
  ipcMain.handle(IpcChannels.memory.evidence, (_, characterId: string, memoryId: string) =>
    wrap(() => memoryEvidence(characterId, memoryId))
  )
  ipcMain.handle(IpcChannels.memory.pending, (_, characterId: string, limit?: number) =>
    wrap(() => pendingFromArchive(characterId, limit))
  )
  ipcMain.handle(IpcChannels.memory.advanceCursor, (_, characterId: string, ts: number) =>
    wrap(() => advanceCursor(characterId, ts))
  )
  handleValidatedWithEvent(
    IpcChannels.memory.rebuild,
    [characterIdSchema, z.string().min(1)],
    async (event, characterId, confirm) => {
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
      return rebuildMemory(characterId, confirm)
    },
  )
  handleValidated(IpcChannels.memory.freezeFact, [characterIdSchema, z.string().min(1)], (characterId, factId) =>
    freezeFact(characterId, factId),
  )
  handleValidated(IpcChannels.memory.unfreezeFact, [characterIdSchema, z.string().min(1)], (characterId, factId) =>
    unfreezeFact(characterId, factId),
  )
  handleValidated(IpcChannels.memory.deleteFact, [characterIdSchema, z.string().min(1)], (characterId, factId) =>
    deleteFact(characterId, factId),
  )
  ipcMain.handle(IpcChannels.memory.getRelevant, (_, characterId: string, context: string) =>
    wrap(async () => ({
      facts: await loadFacts(characterId),
      stories: await loadStories(characterId),
      block: await getMemoryBlock(characterId, context, true)
    }))
  )
}
