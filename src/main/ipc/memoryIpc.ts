import { ipcMain, BrowserWindow, dialog } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type { ChatMessage, MemoryApplyPayload, MemoryFact } from '@shared/types'
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
import { wrap } from './wrap'

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
  ipcMain.handle(IpcChannels.chatHistory.append, (_, characterId: string, messages: ChatMessage[]) =>
    wrap<number[]>(async () => {
      await memoryDbReady()
      return saveChatMessages(characterId, messages)
    })
  )
  ipcMain.handle(
    IpcChannels.chatHistory.replaceAll,
    (_, characterId: string, messages: ChatMessage[]) =>
      wrap<boolean>(() => {
        replaceUnarchivedMessages(
          characterId,
          messages.map((m) => ({
            id: (m as ChatMessage & { dbId?: number }).dbId,
            character_id: characterId,
            role: m.role,
            content: JSON.stringify(m),
            ts: (m as ChatMessage & { ts?: number }).ts ?? Date.now(),
            archived: 0,
          }))
        )
        return true
      })
  )
  ipcMain.handle(IpcChannels.chatHistory.archiveRange, (_, characterId: string, fromId: number, toId: number) =>
    wrap<number>(() => archiveMessagesRange(characterId, fromId, toId))
  )
  ipcMain.handle(IpcChannels.chatHistory.latestMessageId, (_, characterId: string) =>
    wrap<number | null>(() => latestMessageId(characterId))
  )
  ipcMain.handle(IpcChannels.chatHistory.summaries, (_, characterId: string) =>
    wrap(() => listSummaries(characterId))
  )
  ipcMain.handle(
    IpcChannels.chatHistory.summaryAdd,
    (_, characterId: string, s: { start_ts: number; end_ts: number; text: string; message_count: number }) =>
      wrap<boolean>(() => {
        addSummary(characterId, s)
        return true
      })
  )

  ipcMain.handle(
    IpcChannels.chatHistory.commitCompression,
    (
      _,
      characterId: string,
      fromId: number,
      toId: number,
      s: { start_ts: number; end_ts: number; text: string; message_count: number }
    ) => wrap<{ archived: number }>(() => commitCompression(characterId, fromId, toId, s))
  )

  ipcMain.handle(IpcChannels.memory.get, (_, characterId: string) =>
    wrap(async () => ({
      facts: await loadFacts(characterId),
      stories: await loadStories(characterId),
      block: await getMemoryBlock(characterId)
    }))
  )
  ipcMain.handle(IpcChannels.memory.apply, (_, characterId: string, payload: MemoryApplyPayload) =>
    wrap(() => applyCandidates(characterId, payload))
  )
  ipcMain.handle(IpcChannels.memory.manualAdd, (_, characterId: string, text: string, entity?: MemoryFact['entity']) =>
    wrap(() => manualAddFact(characterId, text, entity))
  )
  ipcMain.handle(IpcChannels.memory.clear, (_, characterId: string) => wrap(() => clearMemory(characterId)))
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
  ipcMain.handle(IpcChannels.memory.rebuild, (event, characterId: string, confirm: string) =>
    wrap(async () => {
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
    })
  )
  ipcMain.handle(IpcChannels.memory.freezeFact, (_, characterId: string, factId: string) =>
    wrap(() => freezeFact(characterId, factId))
  )
  ipcMain.handle(IpcChannels.memory.unfreezeFact, (_, characterId: string, factId: string) =>
    wrap(() => unfreezeFact(characterId, factId))
  )
  ipcMain.handle(IpcChannels.memory.deleteFact, (_, characterId: string, factId: string) =>
    wrap(() => deleteFact(characterId, factId))
  )
  ipcMain.handle(IpcChannels.memory.getRelevant, (_, characterId: string, context: string) =>
    wrap(async () => ({
      facts: await loadFacts(characterId),
      stories: await loadStories(characterId),
      block: await getMemoryBlock(characterId, context, true)
    }))
  )
}
