import { readConfig } from '../services/configStore'
import { getBackupRoot, getDataRoot } from '../services/paths'
import { startEnvMonitor } from '../services/envContext'
import { setMemoryDbLogger } from '../services/memoryDb'
import { logBus } from '../services/logBus'
import { initTools } from '../services/tools'
import { initPlugins } from '../services/plugins/registry'
import { initMemoryStore } from '../services/memoryStore'
import type { WindowManager } from '../windows/windowManager'
import { registerConfigIpc } from './configIpc'
import { registerLlmIpc } from './llmIpc'
import { registerMemoryIpc } from './memoryIpc'
import { registerTtsIpc } from './ttsIpc'
import { registerAsrIpc } from './asrIpc'
import { registerSystemIpc } from './systemIpc'
import { registerLogsIpc } from './logsIpc'

export function registerIpc(windows: WindowManager): void {
  setMemoryDbLogger(logBus)
  initTools()
  initPlugins(getDataRoot())
  initMemoryStore(getDataRoot(), readConfig().memory, getBackupRoot())
  startEnvMonitor()
  windows.setSelfExclusion(readConfig().screen?.excludeSelf ?? true)

  registerConfigIpc(windows)
  registerLlmIpc()
  registerMemoryIpc()
  registerTtsIpc()
  registerAsrIpc()
  registerSystemIpc(windows)
  registerLogsIpc()
}
