import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc-channels'
import { speak, cancelSpeech, pingTTS, resetTTSState, warmupTTS } from '../services/ttsClient'
import type { TTSSpeakRequest, TTSSpeakResponse } from '../services/ttsClient'
import { startTTSServer, stopTTSServer, getTTSServerStatus, getTTSServerLog } from '../services/ttsServer'
import type { TTSServerStatus } from '../services/ttsServer'
import { wrap } from './wrap'

export function registerTtsIpc(): void {
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
}
