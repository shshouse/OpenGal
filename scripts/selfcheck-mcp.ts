import assert from 'node:assert'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpSession } from '../src/main/services/plugins/mcpHost.ts'
import { validateManifest } from '../src/main/services/plugins/manifest.ts'

const okM = validateManifest(
  {
    formatVersion: 1,
    id: 'demo',
    name: 'Demo',
    version: '0.1.0',
    contributions: { mcpServers: [{ id: 's1', transport: 'stdio', command: 'node' }] },
  },
  'demo',
)
assert.strictEqual(okM.ok, true)

const badVersion = validateManifest({ formatVersion: 2, id: 'demo', name: 'D', version: '0' }, 'demo')
assert.strictEqual(badVersion.ok, false)

const badDir = validateManifest({ formatVersion: 1, id: 'other', name: 'D', version: '0' }, 'demo')
assert.strictEqual(badDir.ok, false)

const badCmd = validateManifest(
  {
    formatVersion: 1,
    id: 'demo',
    name: 'D',
    version: '0',
    contributions: { mcpServers: [{ id: 's', transport: 'stdio' }] },
  },
  'demo',
)
assert.strictEqual(badCmd.ok, false)

const badPerm = validateManifest(
  { formatVersion: 1, id: 'demo', name: 'D', version: '0', permissions: ['steal:keys'] },
  'demo',
)
assert.strictEqual(badPerm.ok, false)

const okNet = validateManifest(
  { formatVersion: 1, id: 'demo', name: 'D', version: '0', permissions: ['network:example.com'] },
  'demo',
)
assert.strictEqual(okNet.ok, true)

const here = path.dirname(fileURLToPath(import.meta.url))
const session = new McpSession(
  { id: 'echo', transport: 'stdio', command: process.execPath, args: [path.join(here, 'echo-mcp-server.mjs')] },
  'selfcheck',
  () => {},
)
await session.start()
assert.deepStrictEqual(
  session.toolDefs.map((t) => session.toolFullName(t.name)),
  ['mcp__selfcheck__echo__echo'],
)
const out = await session.callTool('echo', { text: '你好' })
assert.strictEqual(out, 'echo: 你好')
session.stop()

console.log('selfcheck-mcp: all pass')
