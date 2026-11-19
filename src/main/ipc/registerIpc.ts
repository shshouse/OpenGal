import { readConfig } from '../services/config/store'
import { getBackupRoot, getDataRoot } from '../services/infra/paths'
import { startEnvMonitor } from '../services/perception/envContext'
import { setScreenWatchEnabled } from '../services/perception/screenWatch'
import { setMemoryDbLogger } from '../services/memory/db'
import { logBus } from '../services/infra/logBus'
import { initTools } from '../services/tools'
import { initPlugins } from '../services/plugins/registry'
import { initMemoryStore } from '../services/memory'
import type { WindowManager } from '../windows/windowManager'
import { registerConfigIpc } from './configIpc'
import { registerLlmIpc } from './llmIpc'
import { registerMemoryIpc } from './memoryIpc'
import { registerTtsIpc } from './ttsIpc'
import { registerAsrIpc } from './asrIpc'
import { registerSystemIpc } from './systemIpc'
import { registerLogsIpc } from './logsIpc'
import { registerUIStateIpc } from './uiStateIpc'
import { registerStorageIpc } from './storageIpc'
import { registerRuntimeAndWorkshopIpc } from './runtimeIpc'

export function registerIpc(windows: WindowManager): void {
  setMemoryDbLogger(logBus)
  initTools()
  initPlugins(getDataRoot())
  initMemoryStore(getDataRoot(), readConfig().memory, getBackupRoot())
  startEnvMonitor()
  windows.setSelfExclusion(readConfig().screen?.excludeSelf ?? true)
  setScreenWatchEnabled(readConfig().screen?.watch ?? false)

  registerConfigIpc(windows)
  registerRuntimeAndWorkshopIpc()
  registerUIStateIpc()
  registerStorageIpc()
  registerLlmIpc()
  registerMemoryIpc()
  registerTtsIpc()
  registerAsrIpc()
  registerSystemIpc(windows)
  registerLogsIpc()
}
