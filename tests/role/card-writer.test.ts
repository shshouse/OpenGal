import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { saveRoleCard } from '../../src/main/services/role/cardWriter'

const tempRoots: string[] = []

function makeRole() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'og-role-writer-'))
  tempRoots.push(dataRoot)
  const folder = path.join(dataRoot, 'roles', 'kaltsit')
  fs.mkdirSync(folder, { recursive: true })
  const file = path.join(folder, 'opengal.json')
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    id: 'kaltsit',
    name: '凯尔希',
    displayName: '凯尔希 Kal\'tsit',
    windowMode: 'mate',
    performance: {
      mode: 'sprite',
      sprite: { spriteDir: 'sprites', defaultSprite: 'idle.png' },
    },
    persona: { description: '旧描述', personality: '旧性格' },
    greeting: '旧问候',
    license: { spdx: 'NOASSERTION' },
  }, null, 2))
  return { dataRoot, file }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('角色卡写回', () => {
  it('只改玩家可编辑字段，保留问候和授权信息', () => {
    const { dataRoot, file } = makeRole()
    const result = saveRoleCard('kaltsit', {
      displayName: '新名字',
      color: '#33C1E6',
      language: 'zh',
      persona: {
        description: '新描述',
        personality: '新性格',
        scenario: '新场景',
        rules: '',
        userIdentity: '博士',
        userTerm: '博士',
      },
    }, dataRoot)

    expect(result.card.displayName).toBe('新名字')
    expect(result.card.persona.description).toBe('新描述')
    expect(result.card.persona.userTerm).toBe('博士')

    const saved = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
    expect(saved.id).toBe('kaltsit')
    expect(saved.name).toBe('凯尔希')
    expect(saved.greeting).toBe('旧问候')
    expect(saved.license).toEqual({ spdx: 'NOASSERTION' })
    expect((saved.persona as Record<string, unknown>).description).toBe('新描述')
  })

  it('写回前保留上一版备份', () => {
    const { dataRoot, file } = makeRole()
    saveRoleCard('kaltsit', {
      persona: { description: '新描述', personality: '新性格' },
    }, dataRoot)

    const backup = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf-8')) as Record<string, unknown>
    expect((backup.persona as Record<string, unknown>).description).toBe('旧描述')
    expect(backup.displayName).toBe('凯尔希 Kal\'tsit')
  })

  it('没有玩家自己的角色目录时拒绝写入', () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'og-role-writer-empty-'))
    tempRoots.push(dataRoot)
    expect(() => saveRoleCard('kaltsit', {
      persona: { description: '新描述', personality: '新性格' },
    }, dataRoot)).toThrow('没有可编辑的角色')
  })
})
