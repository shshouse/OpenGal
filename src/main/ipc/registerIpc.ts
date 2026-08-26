import { ipcMain, BrowserWindow } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import type { AppConfig, ChatMessage, IpcResult, LLMRequest, LLMResponse } from '@shared/types'
import type { LogEntry } from '@shared/log'
import { readConfig, writeConfig } from '../services/configStore'
import { loadHistory, saveHistory, clearHistory } from '../services/chatHistory'
import { callLLM, callLLMStream, abortStream } from '../services/llmClient'
import { resolveDefaultModel, scanModel, resolveModelFromCard } from '../services/modelScanner'
import { listRoleCards, getRoleCard, readRoleVoiceConfig } from '../services/roleCardLoader'
import { speak, pingTTS, resetTTSState } from '../services/ttsClient'
import type { TTSSpeakRequest, TTSSpeakResponse } from '../services/ttsClient'
import {
  startTTSServer,
  stopTTSServer,
  getTTSServerStatus,
  getTTSServerLog
} from '../services/ttsServer'
import type { TTSServerStatus } from '../services/ttsServer'
import { startASR, stopASR, feedAudio, isASRRunning, setResultCallback } from '../services/asr/voskEngine'
import { addLogSubscriber, getAllLogs, clearLogs, logBus } from '../services/logBus'
import { getToolDefinitions, executeTool } from '../services/tools'
import type { WindowManager } from '../windows/windowManager'

function wrap<T>(run: () => Promise<T> | T): Promise<IpcResult<T>> {
  return Promise.resolve()
    .then(run)
    .then((data) => ({ success: true, data }) as IpcResult<T>)
    .catch((error: Error) => ({ success: false, error: error.message }) as IpcResult<T>)
}

export function registerIpc(windows: WindowManager): void {
  ipcMain.handle(IpcChannels.config.get, () => wrap<AppConfig>(() => readConfig()))

  ipcMain.handle(IpcChannels.config.set, (_, patch: Partial<AppConfig>) =>
    wrap<AppConfig>(() => writeConfig(patch))
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

  // ---- 会话历史持久化（按角色一份 JSON，落便携数据根）----
  ipcMain.handle(IpcChannels.chatHistory.load, (_, characterId: string) =>
    wrap<ChatMessage[]>(() => loadHistory(characterId))
  )
  ipcMain.handle(IpcChannels.chatHistory.save, (_, characterId: string, messages: ChatMessage[]) =>
    wrap<boolean>(() => {
      saveHistory(characterId, messages)
      return true
    })
  )
  ipcMain.handle(IpcChannels.chatHistory.clear, (_, characterId: string) =>
    wrap<boolean>(() => {
      clearHistory(characterId)
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
    wrap<TTSServerStatus>(() => startTTSServer())
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
    setResultCallback((text, partial) => {
      if (sender.isDestroyed()) return
      sender.send(partial ? IpcChannels.asr.partial : IpcChannels.asr.final, text)
    })
    return wrap(() => startASR())
  })

  ipcMain.handle(IpcChannels.asr.stop, () => {
    setResultCallback(null)
    stopASR()
    return { success: true }
  })

  ipcMain.on(IpcChannels.asr.feed, (_, buffer: ArrayBuffer) => {
    feedAudio(Buffer.from(buffer))
  })

  ipcMain.handle(IpcChannels.asr.status, () => {
    return { success: true, data: { running: isASRRunning() } }
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
  // renderer 端主动写日志（单向，fire-and-forget），让关键运行时状态进主进程终端
  ipcMain.on(IpcChannels.logs.append, (_, level: string, source: string, message: string, details?: string) => {
    const lv = level === 'warn' || level === 'error' || level === 'debug' ? level : 'info'
    logBus[lv](source || 'renderer', message, details)
  })

  // ---- Tools (function calling) ----
  ipcMain.handle(IpcChannels.tools.list, () => wrap(() => getToolDefinitions()))
  ipcMain.handle(IpcChannels.tools.execute, (_, name: string, argsJson: string) =>
    wrap(() => executeTool(name, argsJson))
  )
}
