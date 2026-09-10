import { ipcMain, BrowserWindow, desktopCapturer } from 'electron'
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
import { speak, pingTTS, resetTTSState, warmupTTS } from '../services/ttsClient'
import type { TTSSpeakRequest, TTSSpeakResponse } from '../services/ttsClient'
import {
  startTTSServer,
  stopTTSServer,
  getTTSServerStatus,
  getTTSServerLog
} from '../services/ttsServer'
import type { TTSServerStatus } from '../services/ttsServer'
import { getEngine } from '../services/asr/factory'
import { getDataRoot } from '../services/paths'
import { addLogSubscriber, getAllLogs, clearLogs, logBus } from '../services/logBus'
import { getToolDefinitions, executeTool } from '../services/tools'
import { initPlugins, scanPlugins, setPluginEnabled, rescanPlugins } from '../services/plugins/registry'
import { initMemoryStore, loadFacts, loadStories, getMemoryBlock, applyCandidates, manualAddFact, clearMemory, decaySweep, freezeFact, unfreezeFact, deleteFact } from '../services/memoryStore'
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
  clearCharacterMessages,
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
  initMemoryStore(getDataRoot(), readConfig().memory)

  async function judgeFact(existing: MemoryFact, cand: MemoryCandidateFact): Promise<'reinforces' | 'negates'> {
    const res = await callLLM({
      messages: [
        {
          role: 'system',
          content:
            '你是记忆一致性裁判。只输出 JSON：{"verdict":"reinforces"} 或 {"verdict":"negates"}。reinforces=新信息确认或补充旧记忆；negates=新信息与旧记忆矛盾。'
        },
        {
          role: 'user',
          content: `旧记忆：${existing.text}\n新信息：${cand.text}\n判断新信息与旧记忆的关系。`
        }
      ]
    })
    const m = res.content.match(/\{[\s\S]*\}/)
    const parsed = m ? (JSON.parse(m[0]) as { verdict?: string }) : {}
    return parsed.verdict === 'negates' ? 'negates' : 'reinforces'
  }

  ipcMain.handle(IpcChannels.config.get, () => wrap<AppConfig>(() => readConfig()))

  ipcMain.handle(IpcChannels.config.set, (_, patch: Partial<AppConfig>) =>
    wrap<AppConfig>(() => {
      const next = writeConfig(patch)
      if (patch.activeCharacterId !== undefined) void warmupTTS()
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
  const rowToChatMessage = (row: { id?: number; role: string; content: string }): ChatMessage => {
    try {
      const parsed = JSON.parse(row.content) as unknown
      const base = (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'role' in (parsed as Record<string, unknown>))
        ? (parsed as ChatMessage)
        : { role: row.role as ChatMessage['role'], content: parsed as ChatMessage['content'] }
      return { ...base, dbId: row.id } as ChatMessage
    } catch {
      return { role: row.role as ChatMessage['role'], content: row.content, dbId: row.id } as ChatMessage
    }
  }

  ipcMain.handle(IpcChannels.chatHistory.load, (_, characterId: string) =>
    wrap<ChatMessage[]>(async () => {
      await memoryDbReady()
      return listUnarchivedMessages(characterId).map(rowToChatMessage)
    })
  )
  ipcMain.handle(IpcChannels.chatHistory.append, (_, characterId: string, messages: ChatMessage[]) =>
    wrap<boolean>(() => {
      saveChatMessages(characterId, messages)
      return true
    })
  )
  ipcMain.handle(
    IpcChannels.chatHistory.replaceAll,
    (_, characterId: string, messages: ChatMessage[]) =>
      wrap<boolean>(() => {
        replaceUnarchivedMessages(
          characterId,
          messages.map((m) => ({
            character_id: characterId,
            role: m.role,
            content: JSON.stringify(m),
            ts: Date.now(),
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

  ipcMain.handle(IpcChannels.pet.open, () => wrap(() => windows.openPetWindow()))
  ipcMain.handle(IpcChannels.pet.close, () => wrap(() => windows.closePetWindow()))
  ipcMain.handle(IpcChannels.pet.bubble, (_, text: string) =>
    wrap(() => windows.sendPetBubble(text))
  )

  ipcMain.handle(IpcChannels.tts.speak, (_, request: TTSSpeakRequest) =>
    wrap<TTSSpeakResponse>(() => speak(request))
  )
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
    getEngine().setResultCallback((text, partial) => {
      if (sender.isDestroyed()) return
      sender.send(partial ? IpcChannels.asr.partial : IpcChannels.asr.final, text)
    })
    return wrap(() => getEngine().start())
  })

  ipcMain.handle(IpcChannels.asr.stop, () => {
    getEngine().setResultCallback(null)
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

  ipcMain.handle(IpcChannels.logs.list, (event) => {
    addLogSubscriber(event.sender)
    return { success: true, data: getAllLogs() } as IpcResult<LogEntry[]>
  })
  ipcMain.handle(IpcChannels.logs.clear, () => {
    clearLogs()
    logBus.info('logs', '日志已清空')
    return { success: true }
  })
  ipcMain.on(IpcChannels.logs.append, (_, level: string, source: string, message: string, details?: string) => {
    const lv = level === 'warn' || level === 'error' || level === 'debug' ? level : 'info'
    logBus[lv](source || 'renderer', message, details)
  })
  ipcMain.handle(IpcChannels.tools.list, () => wrap(() => getToolDefinitions()))
  ipcMain.handle(IpcChannels.tools.execute, (_, name: string, argsJson: string) =>
    wrap(() => executeTool(name, argsJson))
  )
  ipcMain.handle(IpcChannels.plugins.list, () => wrap(() => scanPlugins()))
  ipcMain.handle(IpcChannels.plugins.setEnabled, (_, pluginId: string, enabled: boolean) =>
    wrap(async () => {
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
    wrap(() => applyCandidates(characterId, payload, judgeFact))
  )
  ipcMain.handle(IpcChannels.memory.manualAdd, (_, characterId: string, text: string, entity?: MemoryFact['entity']) =>
    wrap(() => manualAddFact(characterId, text, entity))
  )
  ipcMain.handle(IpcChannels.memory.clear, (_, characterId: string) => wrap(() => clearMemory(characterId)))
  ipcMain.handle(IpcChannels.memory.decaySweep, (_, characterId: string) =>
    wrap(() => decaySweep(characterId))
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
