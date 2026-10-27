import { ipcMain, BrowserWindow, desktopCapturer, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IpcChannels } from '@shared/ipc-channels'
import type { AppConfig, ChatMessage, IpcResult, LLMRequest, LLMResponse } from '@shared/types'
import type { LogEntry } from '@shared/log'
import { readConfig, writeConfig } from '../services/configStore'
import { callLLM, callLLMStream, abortStream, listProviderModels } from '../services/llmClient'
import { fetchMarketMods, openMarketMod } from '../services/marketService'
import { resolveDefaultModel, scanModel, resolveModelFromCard } from '../services/modelScanner'
import { listRoleCards, getRoleCard, readRoleVoiceConfig } from '../services/roleCardLoader'
import { speak, cancelSpeech, pingTTS, resetTTSState, warmupTTS } from '../services/ttsClient'
import type { TTSSpeakRequest, TTSSpeakResponse } from '../services/ttsClient'
import {
  startTTSServer,
  stopTTSServer,
  getTTSServerStatus,
  getTTSServerLog
} from '../services/ttsServer'
import type { TTSServerStatus } from '../services/ttsServer'
import { getEngine } from '../services/asr/factory'
import { getBackupRoot, getDataRoot } from '../services/paths'
import { startEnvMonitor, getEnvSnapshot } from '../services/envContext'
import { runBootSequence, recheckTts } from '../services/bootService'
import { addLogSubscriber, getAllLogs, clearLogs, logBus } from '../services/logBus'
import { getToolDefinitions, executeTool } from '../services/tools'
import { initPlugins, scanPlugins, setPluginEnabled, rescanPlugins, getPluginManifest } from '../services/plugins/registry'
import { memoryEvidence } from '../services/memoryDb'
import { initMemoryStore, loadFacts, loadStories, getMemoryBlock, applyCandidates, manualAddFact, clearMemory, freezeFact, unfreezeFact, deleteFact, pendingFromArchive, advanceCursor, rebuildMemory, pruneOverflow } from '../services/memoryStore'
import {
  setMemoryDbLogger,
  memoryDbReady,
  listUnarchivedMessages,
  saveChatMessages,
  replaceUnarchivedMessages,
  archiveMessagesRange,
  latestMessageId,
  listSummaries,
  addSummary,
  commitCompression,
} from '../services/memoryDb'
import type { MemoryApplyPayload, MemoryCandidateFact, MemoryFact } from '@shared/types'
import type { WindowManager } from '../windows/windowManager'

function wrap<T>(run: () => Promise<T> | T): Promise<IpcResult<T>> {
  return Promise.resolve()
    .then(run)
    .then((data) => ({ success: true, data }) as IpcResult<T>)
    .catch((error: Error) => ({ success: false, error: error.message }) as IpcResult<T>)
}

export function registerIpc(windows: WindowManager): void {
  setMemoryDbLogger(logBus)
  initPlugins(getDataRoot())
  initMemoryStore(getDataRoot(), readConfig().memory, getBackupRoot())
  startEnvMonitor()
  windows.setSelfExclusion(readConfig().screen?.excludeSelf ?? true)

  ipcMain.handle(IpcChannels.config.get, () => wrap<AppConfig>(() => readConfig()))

  ipcMain.handle(IpcChannels.config.set, (_, patch: Partial<AppConfig>) =>
    wrap<AppConfig>(() => {
      const next = writeConfig(patch)
      if (patch.activeCharacterId !== undefined) void warmupTTS()
      if (patch.screen?.excludeSelf !== undefined) windows.setSelfExclusion(patch.screen.excludeSelf)
      return next
    })
  )

  ipcMain.handle(IpcChannels.llm.chat, (_, request: LLMRequest) =>
    wrap<LLMResponse>(() => callLLM(request))
  )

  ipcMain.handle(
    IpcChannels.llm.chatStream,
    (event, request: LLMRequest, streamId: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: 'No window' }
      callLLMStream(request, streamId, win.webContents).catch(() => {})
      return { success: true }
    }
  )

  ipcMain.handle(IpcChannels.llm.streamAbort, (_, streamId: string) => {
    abortStream(streamId)
    return { success: true }
  })

  ipcMain.handle(
    IpcChannels.llm.listModels,
    (_, baseURL: string, apiKey: string) =>
      wrap<string[]>(() => listProviderModels(baseURL, apiKey))
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

  ipcMain.handle(IpcChannels.pet.open, () => wrap(() => windows.openPetWindow()))
  ipcMain.handle(IpcChannels.pet.close, () => wrap(() => windows.closePetWindow()))
  ipcMain.handle(IpcChannels.pet.dragStart, () => wrap(() => windows.dragPetStart()))
  ipcMain.handle(IpcChannels.pet.dragMove, () => wrap(() => windows.dragPetMove()))
  // 桌宠气泡是高频推送，走 send/on；文本截断防御
  ipcMain.on(IpcChannels.pet.setBubble, (_, text: unknown) => {
    if (typeof text === 'string') windows.sendPetBubble(text.slice(0, 500))
  })

  ipcMain.handle(IpcChannels.tts.speak, (_, request: TTSSpeakRequest) =>
    wrap<TTSSpeakResponse>(() => speak(request))
  )
  ipcMain.handle(IpcChannels.tts.cancel, () => wrap(() => cancelSpeech()))
  ipcMain.handle(IpcChannels.tts.ping, () =>
    wrap<{ ok: boolean; message?: string }>(() => pingTTS())
  )
  ipcMain.handle(IpcChannels.tts.reset, () =>
    wrap(() => {
      resetTTSState()
      return true
    })
  )
  ipcMain.handle(IpcChannels.tts.serverStart, () =>
    wrap<TTSServerStatus>(async () => {
      const status = await startTTSServer()
      if (status.running) void warmupTTS()
      return status
    })
  )
  ipcMain.handle(IpcChannels.tts.serverStop, () =>
    wrap<TTSServerStatus>(() => stopTTSServer())
  )
  ipcMain.handle(IpcChannels.tts.serverStatus, () =>
    wrap<TTSServerStatus>(() => getTTSServerStatus())
  )
  ipcMain.handle(IpcChannels.tts.serverLog, () =>
    wrap<string>(() => getTTSServerLog())
  )

  ipcMain.handle(IpcChannels.window.minimize, () => {
    windows.minimizeMain()
  })
  ipcMain.handle(IpcChannels.window.maximize, () => {
    windows.maximizeMain()
  })
  ipcMain.handle(IpcChannels.window.close, () => {
    windows.closeMain()
  })
  ipcMain.handle(IpcChannels.window.isMaximized, () => {
    return windows.isMainMaximized()
  })

  ipcMain.handle(IpcChannels.asr.start, (event) => {
    const sender = BrowserWindow.fromWebContents(event.sender)?.webContents
    if (!sender) return { success: false, error: 'No window' }
    getEngine().setSpeechStartCallback(() => {
      if (!sender.isDestroyed()) sender.send(IpcChannels.asr.speechStart)
    })
    getEngine().setResultCallback((text, partial) => {
      if (sender.isDestroyed()) return
      sender.send(partial ? IpcChannels.asr.partial : IpcChannels.asr.final, text)
    })
    return wrap(() => getEngine().start())
  })

  ipcMain.handle(IpcChannels.asr.stop, () => {
    getEngine().setResultCallback(null)
    getEngine().setSpeechStartCallback(null)
    getEngine().stop()
    return { success: true }
  })

  ipcMain.on(IpcChannels.asr.feed, (_, buffer: ArrayBuffer) => {
    getEngine().feed(Buffer.from(buffer))
  })

  ipcMain.handle(IpcChannels.asr.status, () => {
    return { success: true, data: { running: getEngine().isRunning() } }
  })

  ipcMain.on(IpcChannels.director.log, (_, entry: Record<string, unknown>) => {
    const dir = path.join(getDataRoot(), 'logs')
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const file = path.join(dir, `director-${day}.ndjson`)
    fs.promises
      .mkdir(dir, { recursive: true })
      .then(() => fs.promises.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf-8'))
      .catch((err) => logBus.warn('director', `决策日志写入失败: ${(err as Error).message}`))
  })

  ipcMain.handle(
    IpcChannels.market.list,
    (_, options: { page?: number; sort?: string; category?: string }) =>
      wrap(() => fetchMarketMods(options ?? {}))
  )
  ipcMain.handle(IpcChannels.market.open, (_, modNumber: number, versionId?: string) =>
    wrap(() => openMarketMod(modNumber, versionId))
  )

  ipcMain.handle(IpcChannels.screen.capture, async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 1280 }
      })
      const primary = sources.find((s) => s.display_id !== '') ?? sources[0]
      if (!primary) return { success: false, error: 'no screen source' }
      return { success: true, data: primary.thumbnail.toPNG().toString('base64') }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IpcChannels.env.get, () => wrap(() => getEnvSnapshot()))

  ipcMain.handle(IpcChannels.boot.start, (event) => {
    const sender = event.sender
    return wrap(() =>
      runBootSequence((step) => {
        if (!sender.isDestroyed()) sender.send(IpcChannels.boot.step, step)
      })
    )
  })

  ipcMain.handle(IpcChannels.boot.recheckTts, (event) => {
    const sender = event.sender
    recheckTts((step) => {
      if (!sender.isDestroyed()) sender.send(IpcChannels.boot.step, step)
    })
    return wrap(() => true)
  })

  ipcMain.handle(IpcChannels.logs.list, (event) => {
    addLogSubscriber(event.sender)
    return { success: true, data: getAllLogs() } as IpcResult<LogEntry[]>
  })
  ipcMain.handle(IpcChannels.logs.clear, () => {
    clearLogs()
    logBus.info('logs', '日志已清空')
    return { success: true }
  })
  ipcMain.handle(IpcChannels.logs.reveal, () =>
    wrap(async () => {
      const dir = path.join(getDataRoot(), 'logs')
      await fs.promises.mkdir(dir, { recursive: true })
      const failure = await shell.openPath(dir)
      if (failure) throw new Error(failure)
      return true
    })
  )
  ipcMain.handle(IpcChannels.logs.export, (event, text: string) =>
    wrap(async () => {
      if (typeof text !== 'string' || text.length === 0) throw new Error('没有可导出的内容')
      const win = BrowserWindow.fromWebContents(event.sender)
      const now = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
      const options = {
        title: '导出运行日志',
        defaultPath: `opengal-log-${stamp}.log`,
        filters: [
          { name: '日志文件', extensions: ['log', 'txt'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await fs.promises.writeFile(result.filePath, text, 'utf-8')
      return result.filePath
    })
  )
  ipcMain.on(IpcChannels.logs.append, (_, level: string, source: string, message: string, details?: string) => {
    const lv = level === 'warn' || level === 'error' || level === 'debug' ? level : 'info'
    logBus[lv](source || 'renderer', message, details)
  })
  ipcMain.handle(IpcChannels.tools.list, () => wrap(() => getToolDefinitions()))
  ipcMain.handle(IpcChannels.tools.execute, (_, name: string, argsJson: string) =>
    wrap(() => executeTool(name, argsJson))
  )
  ipcMain.handle(IpcChannels.plugins.list, () => wrap(() => scanPlugins()))
  ipcMain.handle(IpcChannels.plugins.setEnabled, (event, pluginId: string, enabled: boolean) =>
    wrap(async () => {
      if (enabled) {
        const m = getPluginManifest(pluginId)
        const servers = m.contributions?.mcpServers ?? []
        if (servers.length > 0) {
          // 启用即 spawn 本地进程：必须用户在本机原生弹窗里明确同意，渲染进程无法绕过
          const win = BrowserWindow.fromWebContents(event.sender)
          const cmds = servers
            .map((s) => (s.command ? `${s.command} ${(s.args ?? []).join(' ')}`.trim() : (s.url ?? '')))
            .join('\n')
          const perms = (m.permissions ?? []).join('、') || '无声明'
          const { response } = await dialog.showMessageBox(win!, {
            type: 'warning',
            title: '启用插件',
            message: `启用插件「${m.name}」？`,
            detail: `该插件将在你的电脑上启动本地进程：\n${cmds}\n\n声明权限：${perms}`,
            buttons: ['启用', '取消'],
            defaultId: 1,
            cancelId: 1,
          })
          if (response !== 0) return scanPlugins()
        }
      }
      await setPluginEnabled(pluginId, enabled)
      return scanPlugins()
    })
  )
  ipcMain.handle(IpcChannels.plugins.rescan, () => wrap(() => rescanPlugins()))
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
