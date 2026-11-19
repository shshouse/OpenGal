import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanMods } from '../../src/main/services/mods/scanner'
import { createBlankRoleDir } from '../../src/main/services/role/store'
import { exportOwnedRoleFolder } from '../../src/main/services/role/lifecycle'
import { listOwnedRoleCards, listRoleTemplates } from '../../src/main/services/role/cardLoader'
import { createRoleCopy } from '../../src/main/services/role/roleCopy'
import { closeMemoryDb, initMemoryDb, memoryDbReady, saveChatMessages } from '../../src/main/services/memory/db'
import { setReadyPromise } from '../../src/main/services/memory/db/core'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'og-flat-mods-'))
const prevModEnv = process.env.OPENGAL_MOD_ROOT
const prevDataEnv = process.env.OPENGAL_DATA_DIR

afterAll(() => {
  closeMemoryDb()
  setReadyPromise(null)
  if (prevModEnv === undefined) delete process.env.OPENGAL_MOD_ROOT
  else process.env.OPENGAL_MOD_ROOT = prevModEnv
  if (prevDataEnv === undefined) delete process.env.OPENGAL_DATA_DIR
  else process.env.OPENGAL_DATA_DIR = prevDataEnv
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('扁平化 mods 识别与自包含角色实例', () => {
  it('直接放在 mods/ 根目录的不同类型模组都能被自动识别', () => {
    const modRoot = path.join(tmpRoot, 'mods-scan')
    fs.mkdirSync(modRoot, { recursive: true })

    const roleModDir = path.join(modRoot, 'miku-pack')
    fs.mkdirSync(path.join(roleModDir, 'sprites'), { recursive: true })
    fs.writeFileSync(path.join(roleModDir, 'sprites', 'idle.png'), 'png')
    fs.writeFileSync(
      path.join(roleModDir, 'opengal.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'miku',
        name: '初音未来',
        greeting: '你好，今天想听什么歌？',
        examples: [{ user: '唱首歌', assistant: '交给我吧。' }],
        performance: { mode: 'sprite', sprite: { spriteDir: 'sprites', defaultSprite: 'idle.png' } },
        persona: { description: '电子歌姬', personality: '开朗温柔' },
        voice: { engine: 'genie', config: 'voice/config.json' },
      }),
    )

    const skillModDir = path.join(modRoot, 'weather-skill')
    fs.mkdirSync(skillModDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillModDir, 'opengal.json'),
      JSON.stringify({
        id: 'weather-skill',
        name: '天气查询',
        version: '1.0.0',
        kind: 'capability',
        contributions: { mcpServers: [{ id: 'main', command: 'node', args: ['index.js'] }] },
      }),
    )

    const engineDir = path.join(modRoot, 'genie')
    fs.mkdirSync(engineDir, { recursive: true })

    const discovered = scanMods(modRoot)
    expect(discovered.find((m) => m.id === 'miku')?.capabilities).toEqual(
      expect.arrayContaining(['role-template', 'voice']),
    )
    expect(discovered.find((m) => m.id === 'weather-skill')?.capabilities).toContain('skill')
    expect(discovered.find((m) => m.id === 'genie')?.capabilities).toContain('tts-engine')
  })

  it('同一模组模板可创建多个独立角色，且卸载原模组后角色与记忆依然完整可用', async () => {
    const modRoot = path.join(tmpRoot, 'mods-copy')
    const dataRoot = path.join(tmpRoot, 'data-copy')
    fs.mkdirSync(modRoot, { recursive: true })
    fs.mkdirSync(dataRoot, { recursive: true })
    process.env.OPENGAL_MOD_ROOT = modRoot
    process.env.OPENGAL_DATA_DIR = dataRoot

    await initMemoryDb(dataRoot)
    await memoryDbReady()

    const tplDir = path.join(modRoot, 'kaltsit-mod')
    fs.mkdirSync(path.join(tplDir, 'sprites'), { recursive: true })
    fs.writeFileSync(path.join(tplDir, 'sprites', 'idle.png'), 'png')
    fs.writeFileSync(
      path.join(tplDir, 'opengal.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'kaltsit',
        name: '凯尔希',
        displayName: '凯尔希',
        greeting: 'ドクター、かけてくれ。',
        examples: [{ user: '結果は', assistant: '悪くない。' }],
        performance: { mode: 'sprite', sprite: { spriteDir: 'sprites', defaultSprite: 'idle.png' } },
        persona: { description: '罗德岛医疗负责人', personality: '冷静克制' },
      }),
    )

    expect(listRoleTemplates(modRoot)).toHaveLength(1)
    expect(listOwnedRoleCards(dataRoot)).toHaveLength(0)

    const first = createRoleCopy('kaltsit', '凯尔希 一号', 'agent', dataRoot)
    const second = createRoleCopy('kaltsit', '凯尔希 二号', 'life', dataRoot)

    expect(first.id).toBe('kaltsit')
    expect(second.id).toBe('kaltsit-2')
    expect(first.mode).toBe('agent')
    expect(second.mode).toBe('life')
    expect(first.examples).toHaveLength(1)

    saveChatMessages(first.id, [{ role: 'user', content: '只属于一号的对话' } as unknown as { role: string }])

    fs.rmSync(tplDir, { recursive: true, force: true })
    expect(listRoleTemplates(modRoot)).toHaveLength(0)

    const owned = listOwnedRoleCards(dataRoot)
    expect(owned.map((r) => r.id).sort()).toEqual(['kaltsit', 'kaltsit-2'])

    const exportParent = path.join(tmpRoot, 'exported')
    const exportedPath = exportOwnedRoleFolder(dataRoot, first.id, exportParent)
    expect(fs.existsSync(path.join(exportedPath, 'opengal.json'))).toBe(true)
    expect(fs.existsSync(path.join(exportedPath, 'memory.db'))).toBe(true)
    expect(fs.existsSync(path.join(exportedPath, 'memory.db-wal'))).toBe(false)
  })

  it('无任何模组时可直接创建空白自定义角色并生成默认立绘', () => {
    const dataRoot = path.join(tmpRoot, 'data-blank')
    fs.mkdirSync(dataRoot, { recursive: true })
    process.env.OPENGAL_DATA_DIR = dataRoot

    const created = createBlankRoleDir(dataRoot, {
      name: '小春',
      mode: 'life',
      greeting: '早上好。',
      persona: {
        description: '住在桌面角落的插画师朋友',
        personality: '温和安静，喜欢观察天气',
      },
    })
    const owned = listOwnedRoleCards(dataRoot)
    expect(owned).toHaveLength(1)
    expect(owned[0]?.id).toBe(created.roleId)
    expect(owned[0]?.mode).toBe('life')
    expect(owned[0]?.spriteFrames?.idle).toContain('idle.svg')
  })
})
