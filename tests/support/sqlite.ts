import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncCtor } from 'node:sqlite'

const require = createRequire(import.meta.url)
const sqlite = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncCtor }

export const DatabaseSync = sqlite.DatabaseSync
