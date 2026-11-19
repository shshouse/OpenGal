import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { materializeRole } from '../../src/main/services/role/store'

let root: string
let templateDir: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-materialize-'))
  templateDir = path.join(root, 'template')
  fs.mkdirSync(path.join(templateDir, 'sprites'), { recursive: true })
  fs.mkdirSync(path.join(templateDir, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(templateDir, 'attachments'), { recursive: true })
  fs.writeFileSync(
    path.join(templateDir, 'opengal.json'),
    JSON.stringify({ id: 'kaltsit', name: 'kaltsit', displayName: '凯尔希' }),
  )
  fs.writeFileSync(path.join(templateDir, 'memory.db'), 'db')
  fs.writeFileSync(path.join(templateDir, 'memory.db-wal'), 'wal')
  fs.writeFileSync(path.join(templateDir, 'summary.json'), JSON.stringify({ lastMessagePreview: '旧对话' }))
  fs.writeFileSync(path.join(templateDir, 'sprites', 'idle.svg'), '<svg/>')
  fs.writeFileSync(path.join(templateDir, 'logs', 'role.jsonl'), 'old log')
  fs.writeFileSync(path.join(templateDir, 'attachments', 'chat.png'), 'img')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('materializeRole', () => {
  it('复制角色时只带走人设与资产，不继承记忆库、聊天附件与日志', () => {
    const target = materializeRole(
      root,
      templateDir,
      '副本',
      { id: 'kaltsit', folder: 'template' },
      { roleId: 'kaltsit-2' },
    )

    expect(target).toBe(path.join(root, 'roles', '副本'))
    expect(fs.existsSync(path.join(target, 'memory.db'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'memory.db-wal'))).toBe(false)
    expect(fs.existsSync(path.join(target, 'sprites', 'idle.svg'))).toBe(true)

    expect(fs.readdirSync(path.join(target, 'logs'))).toEqual([])
    expect(fs.readdirSync(path.join(target, 'attachments'))).toEqual([])

    const summary = JSON.parse(fs.readFileSync(path.join(target, 'summary.json'), 'utf8')) as {
      lastMessagePreview: string
    }
    expect(summary.lastMessagePreview).toBe('')

    const card = JSON.parse(fs.readFileSync(path.join(target, 'opengal.json'), 'utf8')) as {
      id: string
      displayName: string
    }
    expect(card.id).toBe('kaltsit-2')
    expect(card.displayName).toBe('副本')
  })
})
