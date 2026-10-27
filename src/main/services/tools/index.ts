import { logBus } from '../logBus'
import { registerBuiltinTools } from './builtin'
import { getToolDefinitions } from './registry'

export * from './registry'

let initialized = false

export function initTools(): void {
  if (initialized) return
  initialized = true
  registerBuiltinTools()
  logBus.info('tools', `已注册 ${getToolDefinitions().length} 个工具`)
}
