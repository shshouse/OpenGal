import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpSession } from '../../src/main/services/plugins/mcpHost'
import { validateManifest } from '../../src/main/services/plugins/manifest'

describe('plugin manifest', () => {
  it('接受合法清单与 network 权限', () => {
    const ok = validateManifest(
      {
        formatVersion: 1,
        id: 'demo',
        name: 'Demo',
        version: '0.1.0',
        contributions: { mcpServers: [{ id: 's1', transport: 'stdio', command: 'node' }] },
      },
      'demo',
    )
    expect(ok.ok).toBe(true)
    expect(
      validateManifest(
        { formatVersion: 1, id: 'demo', name: 'D', version: '0', permissions: ['network:example.com'] },
        'demo',
      ).ok,
    ).toBe(true)
  })

  it('拒绝错误版本、目录不匹配、缺命令与未知权限', () => {
    expect(validateManifest({ formatVersion: 2, id: 'demo', name: 'D', version: '0' }, 'demo').ok).toBe(false)
    expect(validateManifest({ formatVersion: 1, id: 'other', name: 'D', version: '0' }, 'demo').ok).toBe(false)
    expect(
      validateManifest(
        {
          formatVersion: 1,
          id: 'demo',
          name: 'D',
          version: '0',
          contributions: { mcpServers: [{ id: 's', transport: 'stdio' }] },
        },
        'demo',
      ).ok,
    ).toBe(false)
    expect(
      validateManifest(
        { formatVersion: 1, id: 'demo', name: 'D', version: '0', permissions: ['steal:keys'] },
        'demo',
      ).ok,
    ).toBe(false)
  })
})

describe('McpSession', () => {
  it('启动 stdio server 并调用工具', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const session = new McpSession(
      {
        id: 'echo',
        transport: 'stdio',
        command: process.execPath,
        args: [path.join(here, '../fixtures/echo-mcp-server.mjs')],
      },
      'integration',
      () => {},
    )
    await session.start()
    expect(session.toolDefs.map((tool) => session.toolFullName(tool.name))).toEqual([
      'mcp__integration__echo__echo',
    ])
    expect(await session.callTool('echo', { text: '你好' })).toBe('echo: 你好')
    session.stop()
  }, 20_000)
})
