import type { AssetResolver, Clock, FileStore, Logger } from '@shared/ports'
import { getDataRoot } from '../services/paths'
import { LogBusLogger } from './log-bus-logger'
import { ModAssetResolver } from './mod-asset-resolver'
import { NodeFileStore } from './node-file-store'
import { SystemClock } from './system-clock'

export { LogBusLogger, ModAssetResolver, NodeFileStore, SystemClock }

// 桌面组合根：只有这里知道具体实现；核心只依赖 @shared/ports
export const clock: Clock = new SystemClock()
export const fileStore: FileStore = new NodeFileStore({ dataDir: getDataRoot })
export const assetResolver: AssetResolver = new ModAssetResolver()
export const logger: Logger = new LogBusLogger()
