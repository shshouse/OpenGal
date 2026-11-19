import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  appendLifeLog,
  archiveMessagesRange,
  clearRoleMessages,
  closeMemoryDb,
  initMemoryDb,
  listLifeLogs,
  listUnarchivedMessages,
  memoryDbReady,
  resolveRoleDbDir,
  saveChatMessages,
  searchMessages,
  sleepRoleDb,
  updateMessageTranslation,
} from '../../src/main/services/memory/db'
import { setReadyPromise } from '../../src/main/services/memory/db/core'
import { listOwnedRoleCards } from '../../src/main/services/role/cardLoader'
import { createBlankRoleDir, reconcileDuplicateRoleIds } from '../../src/main/services/role/store'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'og-p0-p2-'))
const prevDataEnv = process.env.OPENGAL_DATA_DIR
const prevModEnv = process.env.OPENGAL_MOD_ROOT

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

afterAll(() => {
  closeMemoryDb()
  setReadyPromise(null)
  if (prevDataEnv === undefined) delete process.env.OPENGAL_DATA_DIR
  else process.env.OPENGAL_DATA_DIR = prevDataEnv
  if (prevModEnv === undefined) delete process.env.OPENGAL_MOD_ROOT
  else process.env.OPENGAL_MOD_ROOT = prevModEnv
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('P0-P2 数据安全与一致性修复验证', () => {
  it('P0-1: 手动复制角色目录后自动分配独立 ID，绝不静默消失或串库', async () => {
    const dataRoot = path.join(tmpRoot, 'dup-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    process.env.OPENGAL_DATA_DIR = dataRoot
    closeMemoryDb()
    setReadyPromise(null)
    await initMemoryDb(dataRoot)
    await memoryDbReady()

    const origin = createBlankRoleDir(dataRoot, {
      name: 'kaltsit',
      displayName: '凯尔希',
      persona: { description: '医生', personality: '冷静' },
    })
    saveChatMessages(origin.roleId, [
      { role: 'user', content: '原角色的秘密', clientId: 'orig-1', ts: 1000 },
    ])
    sleepRoleDb(origin.roleId)

    // 模拟用户在资源管理器里直接复制一份目录改名
    const copiedDir = path.join(dataRoot, 'roles', '凯尔希-平行线')
    copyDir(origin.rootPath, copiedDir)

    const changes = reconcileDuplicateRoleIds(dataRoot)
    expect(changes).toHaveLength(1)
    expect(changes[0]?.folderName).toBe('凯尔希-平行线')
    expect(changes[0]?.assignedId).not.toBe(origin.roleId)

    const owned = listOwnedRoleCards(dataRoot)
    expect(owned).toHaveLength(2)
    const parallelId = changes[0]!.assignedId
    expect(resolveRoleDbDir(origin.roleId).folderName).toBe('凯尔希')
    expect(resolveRoleDbDir(parallelId).folderName).toBe('凯尔希-平行线')

    // 分别写入各自独立库，互不串库
    saveChatMessages(parallelId, [
      { role: 'user', content: '平行线专属对话', clientId: 'para-1', ts: 2000 },
    ])
    expect(listUnarchivedMessages(origin.roleId)).toHaveLength(1)
    expect(listUnarchivedMessages(parallelId)).toHaveLength(2)
  })

  it('P0-2 & P2-8 & P2-10: clientId 幂等去重、译文落库持久化、清空对话从 FTS 移除但保留压缩归档可搜', async () => {
    const dataRoot = path.join(tmpRoot, 'msg-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    process.env.OPENGAL_DATA_DIR = dataRoot
    closeMemoryDb()
    setReadyPromise(null)
    await initMemoryDb(dataRoot)
    await memoryDbReady()

    const ids1 = saveChatMessages('alpha', [
      { role: 'assistant', content: 'おはよう', clientId: 'life:alpha:100', ts: 100 },
    ])
    const ids2 = saveChatMessages('alpha', [
      { role: 'assistant', content: 'おはよう', clientId: 'life:alpha:100', ts: 100 },
    ])
    expect(ids1).toHaveLength(1)
    expect(ids2).toEqual(ids1)
    expect(listUnarchivedMessages('alpha')).toHaveLength(1)

    expect(updateMessageTranslation('alpha', { clientId: 'life:alpha:100' }, '早上好', 'zh-CN')).toBe(true)
    const loaded = listUnarchivedMessages('alpha')
    expect(loaded[0]?.translation).toBe('早上好')
    expect(loaded[0]?.translation_lang).toBe('zh-CN')

    // 压缩归档（archived = 1）仍应可检索
    const archivedIds = saveChatMessages('alpha', [
      { role: 'user', content: '压缩归档里的蓝莓蛋糕', clientId: 'u-arch', ts: 200 },
    ])
    archiveMessagesRange('alpha', archivedIds[0]!, archivedIds[0]!)
    expect(searchMessages('alpha', '蓝莓蛋糕', { radius: 0 })).toHaveLength(1)

    // 显式清空对话（archived = 2）必须从 FTS 清除，不再命中检索
    saveChatMessages('alpha', [
      { role: 'user', content: '将被清空的秘密西瓜', clientId: 'u-clear', ts: 300 },
    ])
    clearRoleMessages('alpha')
    expect(listUnarchivedMessages('alpha')).toHaveLength(0)
    expect(searchMessages('alpha', '秘密西瓜', { radius: 0 })).toHaveLength(0)
    expect(searchMessages('alpha', '蓝莓蛋糕', { radius: 0 })).toHaveLength(1)
  })

  it('P0-3: 启动时自动只读导入旧全局 data/memory.db 并保留原文件，缺目录时自动从模板实例化', async () => {
    const dataRoot = path.join(tmpRoot, 'legacy-data')
    const modRoot = path.join(tmpRoot, 'legacy-mods')
    fs.mkdirSync(path.join(dataRoot, 'attachments'), { recursive: true })
    fs.writeFileSync(path.join(dataRoot, 'attachments', 'pic.png'), 'imgbytes')

    const tplDir = path.join(modRoot, 'miku-tpl')
    fs.mkdirSync(path.join(tplDir, 'sprites'), { recursive: true })
    fs.writeFileSync(path.join(tplDir, 'sprites', 'idle.png'), 'png')
    fs.writeFileSync(
      path.join(tplDir, 'opengal.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'miku',
        name: '初音未来',
        displayName: '初音未来',
        performance: { mode: 'sprite', sprite: { spriteDir: 'sprites', defaultSprite: 'idle.png' } },
        persona: { description: '电子歌姬', personality: '开朗' },
      }),
    )

    const legacyDbFile = path.join(dataRoot, 'memory.db')
    const legacy = new DatabaseSync(legacyDbFile)
    legacy.exec(`
      CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, ts INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'chat');
      CREATE TABLE memories (id TEXT PRIMARY KEY, role_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fact', text TEXT NOT NULL, entity TEXT NOT NULL DEFAULT 'user', confidence REAL NOT NULL DEFAULT 0.9, source TEXT NOT NULL DEFAULT 'manual', state TEXT NOT NULL DEFAULT 'active', importance INTEGER NOT NULL DEFAULT 8, created_at INTEGER NOT NULL);
      CREATE TABLE summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL, text TEXT NOT NULL, message_count INTEGER NOT NULL, created_at INTEGER NOT NULL);
    `)
    legacy
      .prepare('INSERT INTO messages(role_id, role, content, ts, archived) VALUES(?, ?, ?, ?, 0)')
      .run(
        'miku',
        'user',
        JSON.stringify({
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'opengal://attachments/pic.png' } }],
        }),
        5000,
      )
    legacy
      .prepare('INSERT INTO memories(id, role_id, kind, text, created_at) VALUES(?, ?, ?, ?, ?)')
      .run('mem-legacy-1', 'miku', 'fact', '旧库里的核心记忆', 5000)
    legacy.close()

    process.env.OPENGAL_DATA_DIR = dataRoot
    process.env.OPENGAL_MOD_ROOT = modRoot
    closeMemoryDb()
    setReadyPromise(null)

    await initMemoryDb(dataRoot)
    await memoryDbReady()

    // 原全局库完好保留并备份
    expect(fs.existsSync(legacyDbFile)).toBe(true)
    expect(fs.existsSync(path.join(dataRoot, 'backups', 'legacy-global-memory.db'))).toBe(true)

    // 模板已自动实例化并导入消息、附件与记忆
    const owned = listOwnedRoleCards(dataRoot)
    expect(owned.some((c) => c.id === 'miku')).toBe(true)
    const msgs = listUnarchivedMessages('miku')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.content).toContain('opengal://self-attachments/pic.png')
    expect(fs.existsSync(path.join(resolveRoleDbDir('miku').roleDir, 'attachments', 'pic.png'))).toBe(true)

    // 再次重启不会重复导入
    closeMemoryDb()
    setReadyPromise(null)
    await initMemoryDb(dataRoot)
    await memoryDbReady()
    expect(listUnarchivedMessages('miku')).toHaveLength(1)
  })

  it('P2-7: life_log 轨迹自动滚存裁剪上限 200 条且不影响日记长期保存', async () => {
    const dataRoot = path.join(tmpRoot, 'lifelog-data')
    fs.mkdirSync(dataRoot, { recursive: true })
    process.env.OPENGAL_DATA_DIR = dataRoot
    closeMemoryDb()
    setReadyPromise(null)
    await initMemoryDb(dataRoot)
    await memoryDbReady()

    appendLifeLog('beta', { kind: 'diary', title: '珍贵日记', content: '不应被轨迹挤掉', ts: 1 })
    for (let i = 0; i < 215; i++) {
      appendLifeLog('beta', { kind: 'thought', content: `独白 ${i}`, ts: 10 + i })
    }
    const traces = listLifeLogs('beta', { kind: 'thought', limit: 300 })
    const diaries = listLifeLogs('beta', { kind: 'diary', limit: 50 })
    expect(traces).toHaveLength(200)
    expect(diaries).toHaveLength(1)
    expect(diaries[0]?.title).toBe('珍贵日记')
  })
})
